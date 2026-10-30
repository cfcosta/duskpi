{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

    skill-duckdb-skills = {
      url = "github:duckdb/duckdb-skills";
      flake = false;
    };
    pstack-src = {
      url = "github:cursor/plugins";
      flake = false;
    };
    peekaboo-src = {
      url = "github:openclaw/Peekaboo/v3.2.2";
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
          inherit chrome-cdp;

          resources = pkgs.stdenv.mkDerivation (_: {
            name = "duskpi-resources";
            src = self;

            buildPhase = ''
              mkdir -p $out/{skills,themes}

              cp -rf ${./themes}/* $out/themes/

              cp -rf ${./skills}/* $out/skills/
              cp -rf ${inputs.skill-duckdb-skills}/skills/duckdb-docs $out/skills/duckdb-docs

              # pstack (cursor/plugins). poteto-help links to ../../docs/guide,
              # so the guide lands at the output root next to skills/.
              cp -rf ${inputs.pstack-src}/pstack/skills/* $out/skills/
              mkdir -p $out/docs
              cp -rf ${inputs.pstack-src}/pstack/docs/guide $out/docs/guide

              ${pkgs.lib.optionalString pkgs.stdenv.hostPlatform.isDarwin ''
                mkdir -p $out/skills/peekaboo
                cp -rf ${inputs.peekaboo-src}/skills/peekaboo/* $out/skills/peekaboo/
              ''}

              # Pi requires lowercase hyphenated skill names; two pstack skills
              # use display names instead.
              chmod u+w $out/skills/{poteto-mode,make-bot-ui}/SKILL.md
              substituteInPlace $out/skills/poteto-mode/SKILL.md \
                --replace-fail 'name: Poteto Mode' 'name: poteto-mode'
              substituteInPlace $out/skills/make-bot-ui/SKILL.md \
                --replace-fail 'name: Make Bot UI' 'name: make-bot-ui'

              substituteInPlace $out/skills/chrome-cdp/SKILL.md \
                --replace-fail '##CHROME-CDP##' '${chrome-cdp}/bin/chrome-cdp'

              cat > $out/package.json <<'EOF'
              {
                "name": "duskpi",
                "private": true,
                "keywords": ["pi-package"],
                "pi": {
                  "skills": [
                    "./skills"
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
            ++ pkgs.lib.optionals pkgs.stdenv.hostPlatform.isDarwin [ peekaboo ];
            nativeBuildInputs = [ pkgs.makeWrapper ];
            postBuild = ''
              wrapProgram $out/bin/pi \
                --set SSL_CERT_FILE ${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt \
                --set NODE_EXTRA_CA_CERTS ${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt \
                --add-flags "--skill $out/skills" \
                --add-flags "--theme $out/themes"
            '';
          };
        }
        // pkgs.lib.optionalAttrs pkgs.stdenv.hostPlatform.isDarwin { inherit peekaboo; }
      );
    };
}
