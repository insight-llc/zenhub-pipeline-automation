const core = require("@actions/core");
const github = require("@actions/github");
const { graphql } = require("@octokit/graphql");

const graphqlWithAuth = graphql.defaults({
    baseUrl: "https://api.zenhub.com/public/graphql",
    headers: {
        authorization: `Bearer ${core.getInput("zenhub-graphql-personal-api-key")}`,
    },
});
const payload = github.context.payload;

function getConfiguredPipeline(workspace, pullRequestState) {
    const configuredPipeline = core.getInput("zenhub-pipeline")[pullRequestState];
    const pipeline = getPipelines(workspace.id)
        .find(function (workspacePipeline) {
            return workspacePipeline.name === configuredPipeline;
        });

    return pipeline;
}

async function getPipelines(workspaceId) {
    const variables = {
        workspaceId: workspaceId,
    };
    const query = `
        query ($workspaceId: ID!) {
            workspace(id: $workspaceId) {
                pipelines {
                    nodes {
                        id
                        name
                    }
                }
            }
        }
    `;

    return await graphqlWithAuth(query, variables);
}

async function getWorkspaces() {
    const variables = {
        workspace: core.getInput("zenhub-workspace"),
    };
    const query = `
        query {
            viewer {
                id
                searchWorkspaces(query: "$workspace") {
                nodes {
                        id
                        name
                    repositoriesConnection {
                        nodes {
                                id
                                name
                            }
                        }
                    }
                }
            }
        }
    `;

    return await graphqlWithAuth(query, variables)
        .data
        .viewer
        .searchWorkspaces
        .nodes;
}

async function moveToPipeline(pipeline) {
    const variables = {
        issueId: payload.issue.id,
        pipeline: pipeline.id,
        position: "top",
    };
    const query = `
        mutation ($issueId: ID!, $pipelineId: ID!, $position: Int!) {
            moveIssueToPipelineAndPosition(input: {issueId: $issueId, pipelineId: $pipelineId, position: $position}) {
                issue {
                    id
                    title
                    pipeline {
                        name
                    }
                }
            }
        }
    `;

    return await graphqlWithAuth(query, variables);
};

try {
    const workspaces = getWorkspaces();

    if (workspaces.length === 0) {
        core.setFailed(`No workspaces with the name "${core.getInput("zenhub-workspace")}" found.`);
    }

    for (const workspace of workspaces) {
        const pullRequestState = (payload.review || {}).state || "";
        const pipeline = getConfiguredPipeline(workspace, pullRequestState);

        if (! pipeline) {
            continue;
        }

        moveToPipeline(workspace, pipeline);
    }

    const payload = JSON.stringify(github.context.payload, undefined, 2)
    console.log(`The event payload: ${payload}`);
} catch (error) {
    core.setFailed(error.message);
}
