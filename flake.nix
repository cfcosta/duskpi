{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

    playwright-cli = {
      url = "github:microsoft/playwright-cli";
      flake = false;
    };

    pi-plan = {
      url = "github:devkade/pi-plan";
      flake = false;
    };

    skill-design-taste-frontend = {
      url = "github:Leonxlnx/taste-skill";
      flake = false;
    };
    skill-humanizer = {
      url = "github:blader/humanizer";
      flake = false;
    };
    skill-visual-explainer = {
      url = "github:nicobailon/visual-explainer";
      flake = false;
    };

    skillset-openai = {
      url = "github:openai/skills";
      flake = false;
    };

    llm-agents = {
      url = "github:numtide/llm-agents.nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    { self, ... }@inputs:
    let
      supportedSystems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];

      forEachSupportedSystem =
        f:
        inputs.nixpkgs.lib.genAttrs supportedSystems (
          system:
          f {
            inherit system;

            pkgs = import inputs.nixpkgs {
              inherit system;
            };
          }
        );
    in
    {
      devShells = forEachSupportedSystem (
        { pkgs, system }:
        {
          default = pkgs.mkShellNoCC {
            packages = [
              self.formatter.${system}

              pkgs.bun
            ];
          };
        }
      );

      formatter = forEachSupportedSystem ({ pkgs, ... }: pkgs.oxfmt);

      packages = forEachSupportedSystem (
        { pkgs, system, ... }:
        let
          browsers =
            (builtins.fromJSON (builtins.readFile "${pkgs.playwright-driver}/browsers.json")).browsers;
          chromium-rev = (builtins.head (builtins.filter (x: x.name == "chromium") browsers)).revision;
          chromium-executable-relative =
            if pkgs.stdenv.isDarwin then
              "chrome-mac/Chromium.app/Contents/MacOS/Chromium"
            else
              "chrome-linux64/chrome";
          chromium-executable = "${pkgs.playwright-driver.browsers}/chromium-${toString chromium-rev}/${chromium-executable-relative}";

          playwright-cli-unwrapped = pkgs.buildNpmPackage {
            pname = "playwright-cli";
            version = inputs.playwright-cli.shortRev;
            src = inputs.playwright-cli;
            npmDepsHash = "sha256-4x3ozVrST6LtLoHl9KtmaOKrkYwCK84fwEREaoNaESc=";
            dontNpmBuild = true;
          };

          playwright-cli = pkgs.symlinkJoin {
            name = "playwright-cli";
            paths = [ playwright-cli-unwrapped ];
            nativeBuildInputs = [ pkgs.makeWrapper ];
            postBuild = ''
              wrapProgram $out/bin/playwright-cli \
                --set-default PLAYWRIGHT_BROWSERS_PATH "${pkgs.playwright-driver.browsers}" \
                --set-default PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS "true" \
                --set-default PLAYWRIGHT_MCP_BROWSER "chromium" \
                --set-default PLAYWRIGHT_MCP_EXECUTABLE_PATH "${chromium-executable}" \
                ${pkgs.lib.optionalString pkgs.stdenv.isLinux ''
                  --set-default PLAYWRIGHT_HOST_PLATFORM_OVERRIDE "ubuntu-24.04"
                ''}
            '';
          };

          pi-plan-extension = pkgs.buildNpmPackage {
            pname = "pi-plan";
            version = inputs.pi-plan.shortRev;
            src = inputs.pi-plan;
            npmDepsHash = "sha256-Ht1vEL2dJDXzKhDPn1Vvv6d3zZ0YLeDQVtP0l2fz0NQ=";
            dontNpmBuild = true;
            installPhase = ''
              runHook preInstall
              mkdir -p $out
              cp -r package.json package-lock.json README.md plan.md tsconfig.json src $out/
              runHook postInstall
            '';
          };
        in
        rec {
          inherit playwright-cli pi-plan-extension;

          resources = pkgs.stdenv.mkDerivation (_: {
            name = "duskpi-resources";
            src = self;

            buildPhase = ''
              mkdir -p $out/{extensions,packages,prompts,skills,themes}

              cp -rf ${./extensions}/* $out/extensions/
              mkdir -p $out/extensions/pi-plan
              cp -rf ${pi-plan-extension}/* $out/extensions/pi-plan/
              cat > $out/extensions/pi-plan/index.ts <<'EOF'
              export { default } from "./src/index.ts";
              EOF
              cp -rf ${./packages}/* $out/packages/
              cp -rf ${./prompts}/* $out/prompts/
              cp -rf ${./themes}/* $out/themes/
              cp -rf ${./skills}/rust-proptest $out/skills/rust-proptest

              mkdir -p $out/skills/humanizer
              cp -rf ${inputs.skill-humanizer}/* $out/skills/humanizer/

              mkdir -p $out/skills/visual-explainer
              cp -rf ${inputs.skill-visual-explainer}/* $out/skills/visual-explainer/

              mkdir -p $out/skills/design-taste-frontend
              cp -rf ${inputs.skill-design-taste-frontend}/SKILL.md $out/skills/design-taste-frontend/

              mkdir -p $out/skills/playwright
              cp -rf ${inputs.skillset-openai}/skills/.curated/playwright/* $out/skills/playwright/
              cp -rf ${./skills}/playwright/SKILL.md $out/skills/playwright/

              substituteInPlace $out/skills/playwright/SKILL.md \
                --replace-fail '##PLAYWRIGHT-CLI##' '${playwright-cli}/bin/playwright-cli'

              cat > $out/package.json <<'EOF'
              {
                "name": "duskpi",
                "private": true,
                "keywords": ["pi-package"],
                "pi": {
                  "theme": "catppuccin-mocha",
                  "extensions": [
                    "./extensions/*/index.ts"
                  ],
                  "skills": [
                    "./skills"
                  ],
                  "prompts": [
                    "./prompts"
                  ],
                  "themes": [
                    "./themes"
                  ]
                }
              }
              EOF
            '';
          });

          default = pkgs.symlinkJoin {
            name = "pi";
            paths = [
              inputs.llm-agents.packages.${system}.pi
              resources
            ];
            nativeBuildInputs = [ pkgs.makeWrapper ];
            postBuild = ''
              wrapProgram $out/bin/pi \
                --add-flags "--extension $out/extensions/bug-fix/index.ts" \
                --add-flags "--extension $out/extensions/owasp-fix/index.ts" \
                --add-flags "--extension $out/extensions/refactor/index.ts" \
                --add-flags "--extension $out/extensions/test-audit/index.ts" \
                --add-flags "--extension $out/extensions/pi-catppuccin/index.ts" \
                --add-flags "--extension $out/extensions/pi-plan/index.ts" \
                --add-flags "--skill $out/skills" \
                --add-flags "--prompt-template $out/prompts" \
                --add-flags "--theme $out/themes"
            '';
          };
        }
      );
    };
}
