# web-fetch extension

Registers a `fetch_content` tool plus a `/web-fetch` command.

## Behavior

- fetches a specific page URL directly
- parses the returned HTML with Readability.js
- extracts readable main content for agent/tool use
- lets `/web-fetch` inject the extracted content into the current session context as a user message

## Notes

- `/web-fetch <url>` fetches immediately instead of routing through a prompt template
- `fetch_content` is available as a first-class tool for autonomous workflows
- local and private hosts are blocked for safety
