{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

    skill-design-taste-frontend = {
      url = "github:Leonxlnx/taste-skill";
      flake = false;
    };
    skill-visual-explainer = {
      url = "github:nicobailon/visual-explainer";
      flake = false;
    };
    pi-autoresearch = {
      url = "github:davebcn87/pi-autoresearch";
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

          kagi-search = pkgs.buildGo126Module rec {
            pname = "kagi-search";
            version = "unstable-2026-03-21";
            src = ./skills/kagi-search;
            vendorHash = "sha256-7z/m3GyfBrdEb7CIRAao2YnSDT2yfNbksSgtzUn4SwI=";
            ldflags = [
              "-s"
              "-w"
              "-X main.version=${version}"
            ];
            meta.mainProgram = "kagi-search";
          };

        in
        rec {
          inherit chrome-cdp kagi-search;

          resources = pkgs.stdenv.mkDerivation (_: {
            name = "duskpi-resources";
            src = self;

            buildPhase = ''
              mkdir -p $out/{extensions,packages,prompts,skills,themes}

              cp -rf ${./extensions}/* $out/extensions/
              cp -rf ${./packages}/* $out/packages/

              mkdir -p $out/packages/pi-autoresearch
              cp -rf ${inputs.pi-autoresearch}/* $out/packages/pi-autoresearch/

              cp -rf ${./prompts}/* $out/prompts/
              cp -rf ${./themes}/* $out/themes/
              cp -rf ${./skills}/rust-proptest $out/skills/rust-proptest

              mkdir -p $out/skills/humanizer
              cp -rf ${./skills}/humanizer/* $out/skills/humanizer/

              mkdir -p $out/skills/visual-explainer
              cp -rf ${inputs.skill-visual-explainer}/* $out/skills/visual-explainer/

              mkdir -p $out/skills/design-taste-frontend
              cp -rf ${inputs.skill-design-taste-frontend}/skills/taste-skill/SKILL.md $out/skills/design-taste-frontend/

              cp -rf ${./skills}/chrome-cdp $out/skills/chrome-cdp
              cp -rf ${./skills}/kagi-search $out/skills/kagi-search

              substituteInPlace $out/skills/chrome-cdp/SKILL.md \
                --replace-fail '##CHROME-CDP##' '${chrome-cdp}/bin/chrome-cdp'

              substituteInPlace $out/skills/kagi-search/SKILL.md \
                --replace-fail '##KAGI-SEARCH##' '${kagi-search}/bin/kagi-search'

              cat > $out/package.json <<'EOF'
              {
                "name": "duskpi",
                "private": true,
                "keywords": ["pi-package"],
                "pi": {
                  "theme": "catppuccin-mocha",
                  "extensions": [
                    "./extensions/*/index.ts",
                    "./packages/pi-autoresearch/extensions"
                  ],
                  "skills": [
                    "./skills",
                    "./packages/pi-autoresearch/skills"
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
              kagi-search
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
                --add-flags "--extension $out/extensions/fetch/index.ts" \
                --add-flags "--extension $out/extensions/web-search/index.ts" \
                --add-flags "--extension $out/extensions/plan/index.ts" \
                --add-flags "--extension $out/extensions/btw/index.ts" \
                --add-flags "--extension $out/packages/pi-autoresearch/extensions/pi-autoresearch/index.ts" \
                --add-flags "--skill $out/skills" \
                --add-flags "--skill $out/packages/pi-autoresearch/skills" \
                --add-flags "--prompt-template $out/prompts" \
                --add-flags "--theme $out/themes"
            '';
          };
        }
      );
    };
}
