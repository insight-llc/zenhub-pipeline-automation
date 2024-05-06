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

async function getConfiguredPipeline(workspace) {
    const mapping = JSON5.parse(core.getInput("pull-request-state-mapping").replace(/\n/g, ''));
    const configuredPipeline = mapping[payload.pull_request.state];
    const pipelines = await getPipelines(workspace.id);
    const pipeline = pipelines
        .find(function (workspacePipeline) {
            return workspacePipeline.name === configuredPipeline;
        });

    return pipeline;
}

async function getIssueId() {
    const variables = {
        "issueNumber": payload.pull_request.number,
        "repositoryGhId": payload.repository.id,
    };
    const query = `
        query ($repositoryGhId: Int, $issueNumber: Int!) {
            issueByInfo(issueNumber: $issueNumber, repositoryGhId: $repositoryGhId) {
                id
            }
        }
    `;
    const result = await graphqlWithAuth(query, variables);

    return result
        .issueByInfo
        .id;
}

async function getPipelines(workspaceId) {
    const variables = {
        workspaceId: workspaceId,
    };
    const query = `
        query ($workspaceId: ID!) {
            workspace(id: $workspaceId) {
                pipelines {
                    id
                    name
                }
            }
        }
    `;
    const result = await graphqlWithAuth(query, variables);
console.log("workspace:", result);
    return result
        .workspace
        .pipelines;
}

async function getWorkspaces() {
    const query = `
        query {
            viewer {
                id
                searchWorkspaces(query: "${core.getInput("zenhub-workspace")}") {
                nodes {
                    id
                    name
                }
            }
        }
    `;
    const result = await graphqlWithAuth(query);

    return result
        .viewer
        .searchWorkspaces
        .nodes;
}

async function moveToPipeline(pipeline) {
    const variables = {
        issueId: await getIssueId(),
        pipelineId: pipeline.id,
        position: 0,
    };
    console.log("pipeline:", pipeline);
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

async function process() {
    try {
        const workspaces = await getWorkspaces();

        if (workspaces.length === 0) {
            core.setFailed(`No workspaces with the name "${core.getInput("zenhub-workspace")}" found.`);
        }

        for (const workspace of workspaces) {
            const pipeline = await getConfiguredPipeline(workspace);

            if (! pipeline) {
                continue;
            }

            await moveToPipeline(pipeline);

            core.setOutput("pull-request-id", payload.id);
            core.setOutput("pipeline", pipeline.name);
            console.log(`Moved pull request #${payload.id} to pipeline "${pipeline.name}" in workspace "${workspace.name}".`);
        }
    } catch (error) {
        core.setFailed(error.message);
    }
}
