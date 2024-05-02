const core = require('@actions/core');
const github = require('@actions/github');
const { graphql } = require("@octokit/graphql");

const graphqlWithAuth = graphql.defaults({
    baseUrl: "https://api.zenhub.com/public/graphql",
    headers: {
        authorization: `Bearer ${core.getInput("zenhub-graphql-personal-api-key")}`,
    },
});

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

    return await graphqlWithAuth(query, variables);
}

async function reviewRequiresChanges(workspaceId) {
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

    return await graphqlWithAuth(query, variables);
};

try {
    getWorkspaces()
        .then((result) => {
            return reviewRequiresChanges(result.id);
            console.log(result);
        })
        .catch((error) => {
            console.error(error);
        });
    // `who-to-greet` input defined in action metadata file
    const nameToGreet = core.getInput('who-to-greet');
    console.log(`Hello ${nameToGreet}!`);
    const time = (new Date()).toTimeString();
    core.setOutput("time", time);
    // Get the JSON webhook payload for the event that triggered the workflow
    const payload = JSON.stringify(github.context.payload, undefined, 2)
    console.log(`The event payload: ${payload}`);
} catch (error) {
    core.setFailed(error.message);
}

const getWorkspaces = function () {

    return 'workspaceId';
}
