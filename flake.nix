{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

    playwright-cli = {
      url = "github:microsoft/playwright-cli";
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

    desloppify-src = {
      url = "github:peteromallet/desloppify";
      flake = false;
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
            packages = [ self.formatter.${system} ];
          };
        }
      );

      formatter = forEachSupportedSystem ({ pkgs, ... }: pkgs.oxfmt);

      packages = forEachSupportedSystem (
        { pkgs, ... }:
        let
          browsers = (builtins.fromJSON (builtins.readFile "${pkgs.playwright-driver}/browsers.json")).browsers;
          chromium-rev = (builtins.head (builtins.filter (x: x.name == "chromium") browsers)).revision;
          chromium-executable = "${pkgs.playwright-driver.browsers}/chromium-${toString chromium-rev}/chrome-linux64/chrome";

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
                --set-default PLAYWRIGHT_HOST_PLATFORM_OVERRIDE "ubuntu-24.04" \
                --set-default PLAYWRIGHT_MCP_BROWSER "chromium" \
                --set-default PLAYWRIGHT_MCP_EXECUTABLE_PATH "${chromium-executable}"
            '';
          };

          desloppify = pkgs.python3Packages.buildPythonApplication {
            pname = "desloppify";
            version = inputs.desloppify-src.shortRev;
            pyproject = true;
            src = inputs.desloppify-src;

            build-system = [ pkgs.python3Packages.setuptools ];

            dependencies = with pkgs.python3Packages; [
              tree-sitter-language-pack
              bandit
              defusedxml
              pillow
            ];

            pythonImportsCheck = [ "desloppify" ];
          };
        in
        {
          inherit playwright-cli desloppify;

          pi-bug-fix = pkgs.stdenv.mkDerivation {
            name = "pi-bug-fix";
            src = self;

            buildPhase = ''
              mkdir -p $out/extensions
              cp -rf ${./extensions}/bug-finder $out/extensions/
            '';
          };

          default = pkgs.stdenv.mkDerivation (_: {
            name = "dusk-skills";
            src = self;

            buildPhase = ''
              mkdir -p $out/{prompts,skills}

              cp -rf ${./prompts}/* $out/prompts/
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

              mkdir -p $out/skills/desloppify
              cp -rf ${./skills}/desloppify/SKILL.md $out/skills/desloppify/

              substituteInPlace $out/skills/desloppify/SKILL.md \
                --replace-fail '##DESLOPPIFY##' '${desloppify}/bin/desloppify'
            '';
          });
        }
      );
    };
}
