# ZenHub Pipeline Automation Action

This action sets up automatic issue movement between different ZenHub Pipelines depending on what's happening with the PR.

## Inputs

|Field | Required |Description |
|----- | ----- |----- |
|zenhub-graphql-personal-api-key | ✅ |ZenHub API token. |
|zenhub-workspace | ✅ |ZenHub workspace name. |
|pull-request-state-mapping | ✅ |Provide a mapping between Pull Request status and the corresponding ZenHub Pipeline you want to move the issue to. Possible statuses are: open, closed, merged, commented, changes_requested, approved, dismissed. |

## Outputs

|Field |Description |
|---------- |----- |
|zenhub-issue-id |The ZenHub ID of the pull request. |
|zenhub-pipeline-id |The ZenHub Pipeline ID. |
|zenhub-pipeline-name |The ZenHub Pipeline name. |
|zenhub-workspace-id |The Zenhub ID of the referenced workspace. |

## Example

```yaml
    - uses: insight-llc/zenhub-pipeline-automation@main
        with:
        zenhub-graphql-personal-api-key: ${{ secrets.ZENHUB_GRAPHQL_PERSONAL_API_KEY }}
        zenhub-workspace: "My Team"
        pull-request-state-mapping: |
            {
                "changes_requested": "In Cleanup",
                "open": "In Progress",
            }
```
