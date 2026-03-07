Please **land the plane**:

1. Run the **quality gates** for this application:
    - For JavaScript/Typescript projects, it is `oxfmt` and the actual build systems.
    - For Python projects, it is `ty` and `ruff`.
    - For Rust projects, it is `cargo clippy --all --all-targets` and `cargo fmt`.
    - If inside a project with Nix, run it using `nix develop`.

2. Create a `jujutsu` commit with `jj commit <changed paths> -m <message>`.
    - Use the `Conventional Commits` format for your commits.
    - Beyond a proper commit title, add a detailed description, explaining what
      changed, why and what is the main goal being pursued.
    - This project does not use Git directly, so only commit with `jj` and not `git`.
