# Recursive Language Models note fixture

Recursive Language Models treat the full prompt as part of an external environment.
The root controller should begin from metadata and bounded observations instead of inlining the whole note.
A useful first decomposition is to summarize the introduction into a reusable variable.
Later steps can inspect the environment again and continue from that stored intermediate result.

## Key idea

Keep the large document outside the root context window.
Read slices only when needed.
Store intermediate summaries so the parent loop can reuse them.

## Tail sentinel

SENTINEL_END_TO_END_LONG_NOTE_DO_NOT_LEAK_IN_INITIAL_PROMPT
