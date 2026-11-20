# Setup and config

[← back to the README](../README.md) · [docs index](README.md)

`/sales-machine-scaffold setup` is always the first run. It creates the config and the empty
workspace, and every other command reads from them.

1. **Reads** the local files you point it to (README, docs index, existing marketing copy) and
   prefills what it can.
2. **Asks you once**, in a single message, only for what it could not read: the access model and
   the main call to action, the flagship customer, the personas, words to never use, regulated
   topics and anything internal-only.
3. **Writes** `sales-machine/config.json` and the workspace folders.

It never invents a value. Anything still unknown is written `"[to confirm]"` and listed in the
report until someone fills it in. It stores no secrets, only placeholders.

## What goes in `config.json`

See [`config.example.json`](../config.example.json) for the full shape.

| Field                     | What it holds                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------- |
| `product`                 | name, one-line promise, category                                                            |
| `language`                | language of public content, of team material, and any secondary languages                   |
| `sources`                 | local folders and files: code, docs, release notes, feature flags, notes                    |
| `access`                  | `invite-only`, `open` or `waitlist`; the primary and secondary CTA; CTAs that are forbidden |
| `flagship`                | the customer the home page talks to first, and what they lose today                         |
| `lanes`                   | the self-serve and assisted paths, each with its buying signal                              |
| `personas`                | who buys, what job they want done, which lane they take                                     |
| `integrations`            | the providers the product connects to, and whether each is live                             |
| `loops`                   | which growth loops the machine runs                                                         |
| `neverSay` / `sayInstead` | forbidden claims and words, and the words to use instead                                    |
| `internalOnly`            | things that never appear in public material (revenue levers, internal numbers)              |
| `regulatedTopics`         | sensitive topics and the only true statement allowed about each                             |
| `batch`                   | how many articles per run, and how many from the sales lane                                 |

## Workspace it creates

```
sales-machine/
  config.json
  product-map.md   positioning.md   machine.md   loops.md
  articles/        landing/         manual/      audit/
  system/          report/          history/
```
