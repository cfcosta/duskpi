# duskpi

My personal configuration of the [pi coding agent](https://pi.dev).

## Home Manager module

This flake exports a Home Manager module at `homeModules.default` (also aliased as `homeManagerModules.default`). It is focused on Pi itself:

- installs a Pi package that already bundles the repo's extensions, skills, prompts, and themes
- writes `~/.pi/agent/settings.json`
- registers that same installed package in Pi's `packages` setting
- can activate one of the bundled Catppuccin Pi themes

Example:

```nix
{
  imports = [ inputs.duskpi.homeModules.default ];

  programs.pi = {
    enable = true;
    catppuccin.enable = true;
    # or: theme = "catppuccin-mocha";
  };
}
```

By default, `programs.pi.package` points to `packages.<system>.default`, a wrapped Pi package that includes:

- `bin/pi`
- `extensions/`
- `packages/`
- `skills/`
- `prompts/`
- `themes/`

## Themes

This package also ships Catppuccin themes for Pi under `themes/`:

- `catppuccin-latte`
- `catppuccin-frappe`
- `catppuccin-macchiato`
- `catppuccin-mocha`

These are copied into the default Nix package output so Pi can discover them as package themes.

## Workflow-style extensions

`extensions/bug-fix`, `extensions/owasp-fix`, `extensions/test-audit`, and `extensions/refactor-safety` share the same reusable workflow runtime:

- Extension entrypoints and domain-specific policy live in `extensions/*/*.ts`.
- Shared workflow primitives live in `packages/workflow-core/src/*`.
- Runtime prompts are co-located in each extension's `prompts/*.md`.
- `packages.<system>.default` in `flake.nix` wraps the `pi` package from `numtide/llm-agents.nix` together with all bundled Pi resources from this repo.

This keeps prompt ownership explicit while shipping a single Pi package with the expected behavior.
