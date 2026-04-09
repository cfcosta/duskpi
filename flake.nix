{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

    skill-visual-explainer = {
      url = "github:nicobailon/visual-explainer";
      flake = false;
    };
    skill-userinterface-wiki = {
      url = "github:raphaelsalaja/userinterface-wiki";
      flake = false;
    };
    skill-duckdb-skills = {
      url = "github:duckdb/duckdb-skills";
      flake = false;
    };
    skill-impeccable = {
      url = "github:pbakaus/impeccable";
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
              pkgs.tmux
            ];
          };
        }
      );

      formatter = forEachSupportedSystem ({ pkgs, ... }: pkgs.oxfmt);

      packages = forEachSupportedSystem (
        { pkgs, system, ... }:
        let
          chrome-cdp = pkgs.writeShellScriptBin "chrome-cdp" ''
            exec ${pkgs.bun}/bin/bun ${./skills/chrome-cdp/scripts/cdp.mjs} "$@"
          '';
        in
        rec {
          inherit chrome-cdp;

          resources = pkgs.stdenv.mkDerivation (_: {
            name = "duskpi-resources";
            src = self;

            buildPhase = ''
              mkdir -p $out/{extensions,packages,prompts,skills,themes}

              cp -rf ${./extensions}/* $out/extensions/
              cp -rf ${./packages}/* $out/packages/

              cp -rf ${./prompts}/* $out/prompts/
              cp -rf ${./themes}/* $out/themes/
              cp -rf ${./skills}/rust-proptest $out/skills/rust-proptest

              mkdir -p $out/skills/humanizer
              cp -rf ${./skills}/humanizer/* $out/skills/humanizer/

              mkdir -p $out/skills/visual-explainer
              cp -rf ${inputs.skill-visual-explainer}/* $out/skills/visual-explainer/

              mkdir -p $out/skills/userinterface-wiki
              cp -rf ${inputs.skill-userinterface-wiki}/skills/* $out/skills/userinterface-wiki/

              cp -rf ${inputs.skill-duckdb-skills}/skills/duckdb-docs $out/skills/duckdb-docs

              cp -rf ${inputs.skill-impeccable}/.pi/skills/* $out/skills/
              chmod -R u+w $out/skills/frontend-design $out/skills/teach-impeccable
              rm -rf $out/skills/frontend-design $out/skills/teach-impeccable

              cp -rf ${./skills}/chrome-cdp $out/skills/chrome-cdp
              cp -rf ${./skills}/autoresearch-create $out/skills/autoresearch-create

              substituteInPlace $out/skills/chrome-cdp/SKILL.md \
                --replace-fail '##CHROME-CDP##' '${chrome-cdp}/bin/chrome-cdp'

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
                --set SSL_CERT_FILE ${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt \
                --set NODE_EXTRA_CA_CERTS ${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt \
                --add-flags "--extension $out/extensions/bug-fix/index.ts" \
                --add-flags "--extension $out/extensions/owasp-fix/index.ts" \
                --add-flags "--extension $out/extensions/refactor/index.ts" \
                --add-flags "--extension $out/extensions/test-audit/index.ts" \
                --add-flags "--extension $out/extensions/catppuccin/index.ts" \
                --add-flags "--extension $out/extensions/web-fetch/index.ts" \
                --add-flags "--extension $out/extensions/web-search/index.ts" \
                --add-flags "--extension $out/extensions/plan/index.ts" \
                --add-flags "--extension $out/extensions/btw/index.ts" \
                --add-flags "--extension $out/extensions/autoresearch/index.ts" \
                --add-flags "--skill $out/skills" \
                --add-flags "--prompt-template $out/prompts" \
                --add-flags "--theme $out/themes"
            '';
          };
        }
      );
    };
}
