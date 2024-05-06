# ZenHub Pipeline Automation GitHub Action

This GitHub Action automates the movement of issues between different ZenHub Pipelines based on the Pull Request (PR) status. It uses the ZenHub API to manage the issue movement and provides a mapping between PR statuses and the corresponding ZenHub Pipelines.

## Configuration

The following inputs are available for the ZenHub Pipeline Automation GitHub Action:

- `zenhub-graphql-personal-api-key`: (required) Your ZenHub API token.
- `zenhub-workspace`: (required) The name of your ZenHub workspace.
- `pull-request-state-mapping`: (optional) A mapping of Pull Request statuses to the corresponding ZenHub Pipelines. Possible statuses are: `draft`, `open`, `closed`, `merged`, `commented`, `reviews_requested`, `changes_requested`, `approved`, or `dismissed`. If not provided, this action will use your pipeline stages as configured in your ZenHub workspace:
  - draft, open, changes_requested, dismissed => In Progress
  - reviews_requested, approved => In Review
  - closed, merged => Completed

## Usage

1. Create a new workflow file in your repository (e.g., `.github/workflows/zenhub_automation.yml`).
2. Add the following content to the workflow file:

    ```yaml
    name: ZenHub Pipeline Automation

    on:
    pull_request

    jobs:
    zenhub_automation:
        runs-on: ubuntu-latest
        steps:
        - uses: actions/checkout@v2
        - uses: insight-llc/zenhub-pipeline-automation@main
            with:
            zenhub-graphql-personal-api-key: ${{ secrets.ZENHUB_GRAPHQL_PERSONAL_API_KEY }}
            zenhub-workspace: "My Team"
            pull-request-state-mapping: |
                {
                "draft": "In Development",
                "open": "In Review",
                "closed": "Closed"
                }
    ```

3. Replace `"My Team"` with the name of your ZenHub workspace.
4. Update the `pull-request-state-mapping` section with the desired mapping between PR statuses and ZenHub Pipelines.
5. Create a new secret in your repository named `ZENHUB_GRAPHQL_PERSONAL_API_KEY` and add your ZenHub API token as the value.
6. Commit and push the changes to your repository.

### Example Mapping

```json
{
  "draft": "In Development",
  "open": "In Review",
  "closed": "Closed"
}
```

In this example, when a PR is created as a draft, it will be moved to the "In Development" pipeline. When the PR is opened, it will be moved to the "In Review" pipeline. When the PR is closed, it will be moved to the "Closed" pipeline.

## Limitations

- The action does not support moving issues between different ZenHub workspaces.
- The action does not support moving issues between GitHub repositories within the same ZenHub workspace.

## Troubleshooting

If you encounter any issues with the ZenHub Pipeline Automation GitHub Action, please check the action logs for error messages. Make sure you have provided the correct inputs and have created the necessary secrets in your repository.
