const _ = require("lodash");
const core = require("@actions/core");
const github = require("@actions/github");
const JSON5 = require("json5");

let payload = github.context.payload;
let graphql;
let graphqlWithAuth;

import("@octokit/graphql")
    .then((octokit) => {
        graphql = octokit.graphql;
        graphqlWithAuth = graphql.defaults({
            baseUrl: "https://api.zenhub.com/public",
            headers: {
                authorization: `Bearer ${core.getInput("zenhub-graphql-personal-api-key")}`,
            },
        });
        process();
    });

function getConfiguredPipeline(pipelines) {
    return _.chain(pipelines)
        .reduce(function (name, pipeline) {
            if (
                (payload.pull_request.draft
                    && pipeline.stage === "DEVELOPMENT")
                || (! payload.pull_request.draft
                    && pipeline.stage === "REVIEW")
            ) {
                return pipeline.name;
            }

            return name;
        }, undefined)
        .value();
}

function getMappedPipeline(pipelines) {
    const mapping = JSON5.parse(core.getInput("pull-request-state-mapping").replace(/\n/g, ''));

    const pipeline = _.chain(mapping || [])
        .reduce(function (name, pipeline, key) {
            if (
                (payload.pull_request.draft
                    && key === "draft")
                || payload.pull_request.state === key
            ) {
                return pipeline.name;
            }

            return name;
        }, undefined)
        .value();
console.log(pipeline, pipelines, _.find(pipelines, {"name": pipeline}));
    return _.find(pipelines, {"name": pipeline});
}

async function getIssue() {
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
    const result = await graphqlWithAuth(query, variables);

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
    const result = await graphqlWithAuth(query);

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
    await graphqlWithAuth(query, variables);
};

async function process() {
    try {
        const issue = await getIssue();
        const workspace = await getWorkspace();
        const pipelines = workspace.pipelinesConnection.nodes;
        const pipeline = getMappedPipeline(pipelines)
            || getConfiguredPipeline(pipelines);

        if (! workspace) {
            core.setFailed(`No workspaces with the name "${core.getInput("zenhub-workspace")}" found.`);
        }

        if (! issue) {
            core.setFailed(`Pull request was not found in ZenHub.`);
        }

        if (! pipeline) {
            core.setFailed(`No ZenHub pipeline was not found.`);
        }

        if (issue.pipeline.name === pipeline.name) {
            console.log(`Pull request #${payload.pull_request.number} is already in pipeline "${pipeline.name}" in workspace "${workspace.name}". No action taken.`);
        }

        await moveIssueToPipeline(issue, pipeline);

        core.setOutput("zenhub-issue-id", issue.id);
        core.setOutput("zenhub-pipeline-id", pipeline.id);
        core.setOutput("zenhub-pipeline-name", pipeline.name);
        core.setOutput("zenhub-workspace-id", workspace.id);
        console.log(`Moved pull request #${payload.pull_request.id} to pipeline "${pipeline.name}" in workspace "${workspace.name}".`);
    } catch (error) {
        core.setFailed(error.message);
    }
}
