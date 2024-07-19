const _ = require("lodash");
const core = require("@actions/core");
const JSON5 = require("json5");

const github = require("@actions/github");
const payload = github.context.payload;
let graphqlWithGitHubAuth;
let graphqlWithZenHubAuth;

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

function arePullRequestReviews(reviews, state) {
    const states = _.chain(reviews)
        .groupBy("author.login")
        .mapValues((states) => _.maxBy(states, "createdAt").state)
        .values()
        .uniq()
        .value();

    return states.length === 1
        && states[0] === state;
}

function getConfiguredPipeline(pipelines, state) {
    console.log(pipelines);
    return _.chain(pipelines)
        .filter(function (pipeline) {
            return ((state === "draft"
                        || state === "open"
                        || state === "changes_requested"
                        || state === "dismissed")
                    && pipeline.stage === "DEVELOPMENT")
                || ((state === "reviews_requested"
                    && pipeline.stage === "REVIEW")
                || ((state === "approved"
                        || state === "merged")
                    && pipeline.stage === "COMPLETED"));
        })
        .first()
        .value();
}

function getMappedPipeline(pipelines, state) {
    const mapping = JSON5.parse(core.getInput("pull-request-state-mapping").replace(/\n/g, ''));
    const pipeline = _.chain(mapping || [])
        .reduce(function (name, pipeline, key) {
            if (state === key) {
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
                    merged
                    isDraft
                    reviewDecision
                    comments {
                        totalCount
                    }
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
    if (pullRequest.isDraft) {
        return "draft";
    }

    if (pullRequest.merged) {
        return "merged";
    }

    if (pullRequest.reviewDecision === "CHANGES_REQUESTED") {
        return "changes_requested";
    }

    if (pullRequest.reviewDecision === "APPROVED") {
        return "approved";
    }

    if (
        pullRequest.reviews.nodes.length > 0
        && arePullRequestReviews(pullRequest.reviews.nodes, "DISMISSED")
    ) {
        return "dismissed";
    }

    if (
        pullRequest.reviewRequests.totalCount > 0
        && pullRequest.reviewDecision === "REVIEW_REQUIRED"
    ) {
        return "reviews_requested";
    }

    if (pullRequest.comments.totalCount > 0) {
        return "commented";
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
            issueId: issue.id,
            pipelineId: pipeline.id,
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

    console.log(pipeline);

    if (pipeline.stage === "DEVELOPMENT") {
        await graphqlWithZenHubAuth(query, variables);
    };
}

function wait(milliseconds) {
    return new Promise(function (resolve) {
        setTimeout(resolve, milliseconds);
    });
}

async function process() {
    try {
        let delay = 0;
        const gitHubPullRequest = await getGitHubPullRequest();
        const pullRequestState = getState(gitHubPullRequest);

        console.log(`"${github.context.eventName}" event registered with state "${pullRequestState}".`);

        const zenHubPullRequest = await getZenHubPullRequest();
        const workspace = await getWorkspace();
        const pipelines = workspace.pipelinesConnection.nodes;
        const pipeline = getMappedPipeline(pipelines, pullRequestState)
            || getConfiguredPipeline(pipelines, pullRequestState);

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

        if (pullRequestState === "merged") {
            delay = 10000;
        }

        await wait(delay);
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
