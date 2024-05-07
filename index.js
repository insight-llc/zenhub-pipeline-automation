const _ = require("lodash");
const core = require("@actions/core");
const github = require("@actions/github");
const JSON5 = require("json5");

const payload = github.context.payload;
const event = github.context.eventName;
const state = (payload.review || {}).state
    || (payload.pull_request || {}).state;
let graphqlWithGitHubAuth;
let graphqlWithZenHubAuth;

console.log(`"${event}" event registered with state "${state}".`);

import("@octokit/graphql")
    .then((octokit) => {
        const graphql = octokit.graphql;

        graphqlWithGitHubAuth = graphql.defaults({
            baseUrl: "https://api.github.com",
            headers: {
                authorization: `Bearer ${core.getInput("github-token")}`,
            },
        });
        graphqlWithZenHubAuth = graphql.defaults({
            baseUrl: "https://api.zenhub.com/public",
            headers: {
                authorization: `Bearer ${core.getInput("zenhub-graphql-personal-api-key")}`,
            },
        });
        process();
    });

function getConfiguredPipeline(pipelines) {
    return _.chain(pipelines)
        .filter(function (pipeline) {
            return ((payload.pull_request.draft
                        || state === "open"
                        || state === "changes_requested"
                        || state === "dismissed")
                    && pipeline.stage === "DEVELOPMENT")
                || ((payload.pull_request.requested_reviewers.length + payload.pull_request.requested_teams.length > 0
                        || state === "approved")
                    && pipeline.stage === "REVIEW");
        })
        .value();
}

function getMappedPipeline(pipelines) {
    const mapping = JSON5.parse(core.getInput("pull-request-state-mapping").replace(/\n/g, ''));
    const pipeline = _.chain(mapping || [])
        .reduce(function (name, pipeline, key) {
            if (
                (payload.pull_request.draft
                    && key === "draft")
                || (payload.pull_request.requested_reviewers.length + payload.pull_request.requested_teams.length > 0
                    && key === "reviews_requested")
                || payload.pull_request.state === key
            ) {
                return pipeline;
            }

            return name;
        }, undefined)
        .value();

    return _.find(pipelines, {"name": pipeline});
}

async function getZenHubPullRequest() {
    const variables = {
        "issueNumber": payload.pull_request.number,
        "repositoryGhId": payload.repository.id,
    };
    const query = `
        query ($repositoryGhId: Int, $issueNumber: Int!) {
            issueByInfo(issueNumber: $issueNumber, repositoryGhId: $repositoryGhId) {
                id
                pipelineIssues {
                    edges {
                        node {
                            pipeline {
                                id
                                name
                            }
                        }
                    }
                }
            }
        }
    `;
    const result = await graphqlWithZenHubAuth(query, variables);

    return {
        "id": result
            .issueByInfo
            .id,
        "pipeline": result
            .issueByInfo
            .pipelineIssues
            .edges[0]
            .node
            .pipeline,
    };
}

async function getGitHubPullRequest() {
    const variables = {
        "repositoryOwner": payload.repository.owner.login,
        "repositoryName": payload.repository.name,
        "pullRequestNumber": payload.pull_request.number,
    };
    const query = `
        query ($repositoryOwner: String!, $repositoryName: String!, $pullRequestNumber: Int!) {
            repository(owner: $repositoryOwner, name: $repositoryName) {
                pullRequest(number: $pullRequestNumber) {
                    number
                    id
                    state
                    isDraft
                    reviewDecision
                    statusCheckRollup {
                        state
                    }
                    reviewRequests {
                        totalCount
                    }
                    reviews(last: 100) {
                        nodes {

                            state
                            createdAt
                            author {
                                login
                            }
                        }
                    }
                }
            }
        }
    `;
    const result = await graphqlWithGitHubAuth(query, variables);

    return result
        .repository
        .pullRequest;
}

function getState(pullRequest) {
    console.log("pull request:", pullRequest);
    if (pullRequest.isDraft) {
        return "draft";
    }

    if (
        pullRequest.reviewRequests.totalCount > 0
        && pullRequest.reviewDecision === "REVIEW_REQUIRED"
    ) {
        return "reviews_requested";
    }

    if (pullRequest.pullRequest.reviews.nodes.length > 0) {
        return pullRequest.pullRequest.reviews.nodes[0].state;
    }

    return pullRequest.state.toLowerCase();
}

async function getWorkspace() {
    const query = `
        query {
            viewer {
                id
                searchWorkspaces(query: "${core.getInput("zenhub-workspace")}") {
                nodes {
                    id
                    name
                    pipelinesConnection {
                        nodes {
                                id
                                name
                                stage
                            }
                        }
                    }
                }
            }
        }
    `;
    const result = await graphqlWithZenHubAuth(query);

    return result
        .viewer
        .searchWorkspaces
        .nodes[0]
        || {};
}

async function moveIssueToPipeline(issue, pipeline) {
    const variables = {
        input: {
            clientMutationId: "test",
            issueId: issue.id,
            pipelineId: pipeline.id,
            position: 0,
        }
    };
    const query = `
        mutation MoveIssue($input: MoveIssueInput!) {
            moveIssue(input: $input) {
                issue {
                    id
                }
            }
        }
    `;
    await graphqlWithZenHubAuth(query, variables);
};

async function process() {
    try {
        const gitHubPullRequest = await getGitHubPullRequest();
        const zenHubPullRequest = await getZenHubPullRequest();
        const pullRequestState = getState(gitHubPullRequest);
        const workspace = await getWorkspace();
        const pipelines = workspace.pipelinesConnection.nodes;
        const pipeline = getMappedPipeline(pipelines)
            || getConfiguredPipeline(pipelines);

        if (! workspace) {
            core.setFailed(`No workspaces with the name "${core.getInput("zenhub-workspace")}" found.`);
        }

        if (! gitHubPullRequest) {
            core.setFailed(`Pull request was not found in GitHub.`);
        }

        if (! zenHubPullRequest) {
            core.setFailed(`Pull request was not found in ZenHub.`);
        }

        if (! pipeline) {
            core.setFailed(`No ZenHub pipeline was not found.`);
        }

        if (zenHubPullRequest.pipeline.name === pipeline.name) {
            console.log(`Pull request #${payload.pull_request.number} is already in pipeline "${pipeline.name}" in workspace "${workspace.name}". No action taken.`);

            return;
        }

        await moveIssueToPipeline(zenHubPullRequest, pipeline);

        core.setOutput("zenhub-issue-id", zenHubPullRequest.id);
        core.setOutput("zenhub-pipeline-id", pipeline.id);
        core.setOutput("zenhub-pipeline-name", pipeline.name);
        core.setOutput("zenhub-workspace-id", workspace.id);

        console.log(`Moved pull request #${payload.pull_request.id} to pipeline "${pipeline.name}" in workspace "${workspace.name}".`);
    } catch (error) {
        core.setFailed(error.message);
    }
}
