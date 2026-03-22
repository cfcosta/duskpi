# web-search extension

Registers a `web_search` tool backed directly by the Kagi Search API, plus a `/web-search` command that turns a query into a focused user request.

## Behavior

- searches the web through Kagi
- optionally fetches and extracts readable page content from returned result URLs
- returns structured details plus plain-text output for the model

## Configuration

Set `KAGI_API_KEY` in the environment.

The tool performs the Kagi request itself instead of shelling out to the old `kagi-search` CLI.
