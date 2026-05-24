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
    skill-hunk = {
      url = "github:modem-dev/hunk";
      flake = false;
    };
    peekaboo-src = {
      url = "github:openclaw/Peekaboo/v3.2.2";
      flake = false;
    };
    pi-mcp-adapter-src = {
      url = "github:nicobailon/pi-mcp-adapter";
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

          pi-mcp-adapter = pkgs.buildNpmPackage {
            pname = "pi-mcp-adapter";
            version = "2.4.0";
            src = inputs.pi-mcp-adapter-src;
            npmDepsHash = "sha256-9P71EDq++Bmez3QDEbOL+PCtCFI2ajxy345stBOBp8k=";
            dontNpmBuild = true;
            installPhase = ''
              runHook preInstall
              mkdir -p $out
              cp -rf . $out/
              runHook postInstall
            '';
          };

          # macOS-only: prebuilt universal binary from the upstream release.
          # Peekaboo is a Swift/AppKit macOS automation CLI, so it is only
          # wired into the darwin build below.
          peekaboo = pkgs.stdenvNoCC.mkDerivation {
            pname = "peekaboo";
            version = "3.2.2";
            src = pkgs.fetchurl {
              url = "https://github.com/openclaw/Peekaboo/releases/download/v3.2.2/peekaboo-macos-universal.tar.gz";
              hash = "sha256-g70CcZCaV1yPlbyF0nHSULSdcoroVNJmK6qdUj9LWmo=";
            };
            sourceRoot = "peekaboo-macos-universal";
            dontBuild = true;
            dontStrip = true; # signed Mach-O; stripping would break the signature
            installPhase = ''
              runHook preInstall
              install -Dm755 peekaboo $out/bin/peekaboo
              runHook postInstall
            '';
            meta = {
              description = "macOS automation CLI: screenshots, UI maps, input control, agent runtime";
              homepage = "https://peekaboo.sh";
              license = pkgs.lib.licenses.mit;
              platforms = pkgs.lib.platforms.darwin;
              mainProgram = "peekaboo";
            };
          };
        in
        rec {
          inherit chrome-cdp pi-mcp-adapter;

          resources = pkgs.stdenv.mkDerivation (_: {
            name = "duskpi-resources";
            src = self;

            buildPhase = ''
              mkdir -p $out/{extensions,packages,prompts,skills,themes}

              cp -rf ${./extensions}/* $out/extensions/
              cp -rf ${./packages}/* $out/packages/

              mkdir -p $out/extensions/pi-mcp-adapter
              cp -rf ${pi-mcp-adapter}/. $out/extensions/pi-mcp-adapter/

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
              cp -rf ${inputs.skill-hunk}/skills/hunk-review $out/skills/hunk-review

              cp -rf ${./skills}/chrome-cdp $out/skills/chrome-cdp
              cp -rf ${./skills}/autoresearch-create $out/skills/autoresearch-create
              cp -rf ${./skills}/jujutsu $out/skills/jujutsu
              cp -rf ${./skills}/bus-pack $out/skills/bus-pack
              cp -rf ${./skills}/code-pkm $out/skills/code-pkm
              cp -rf ${./skills}/debrief $out/skills/debrief
              cp -rf ${./skills}/diataxis $out/skills/diataxis
              cp -rf ${./skills}/dichotomy $out/skills/dichotomy
              cp -rf ${./skills}/dip-or-cul-de-sac $out/skills/dip-or-cul-de-sac
              cp -rf ${./skills}/growth-hack $out/skills/growth-hack
              cp -rf ${./skills}/hacker-mindset $out/skills/hacker-mindset
              cp -rf ${./skills}/lead-magnet $out/skills/lead-magnet
              cp -rf ${./skills}/mental-models $out/skills/mental-models
              cp -rf ${./skills}/offer-doctor $out/skills/offer-doctor
              cp -rf ${./skills}/permission-audit $out/skills/permission-audit
              cp -rf ${./skills}/prompt-humans $out/skills/prompt-humans
              cp -rf ${./skills}/taste-loop $out/skills/taste-loop
              cp -rf ${./skills}/voss $out/skills/voss

              ${pkgs.lib.optionalString pkgs.stdenv.isDarwin ''
                mkdir -p $out/skills/peekaboo
                cp -rf ${inputs.peekaboo-src}/skills/peekaboo/* $out/skills/peekaboo/
              ''}

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
            ]
            ++ pkgs.lib.optionals pkgs.stdenv.isDarwin [ peekaboo ];
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
                --add-flags "--extension $out/extensions/pi-mcp-adapter/index.ts" \
                --add-flags "--skill $out/skills" \
                --add-flags "--prompt-template $out/prompts" \
                --add-flags "--theme $out/themes"
            '';
          };
        }
        // pkgs.lib.optionalAttrs pkgs.stdenv.isDarwin { inherit peekaboo; }
      );
    };
}
