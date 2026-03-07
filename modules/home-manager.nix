{ self }:
{
  config,
  lib,
  pkgs,
  ...
}:
let
  inherit (lib)
    mkEnableOption
    mkIf
    mkOption
    optionalAttrs
    recursiveUpdate
    types
    unique
    ;

  cfg = config.programs.pi;

  flavor = if config.catppuccin.enable or false then config.catppuccin.flavor else cfg.catppuccin.flavor;

  resolvedTheme = if cfg.catppuccin.enable then "catppuccin-${flavor}" else cfg.theme;

  baseSettings = {
    defaultProvider = cfg.defaultProvider;
    defaultModel = cfg.defaultModel;
    packages = [ (toString cfg.package) ];
  }
  // optionalAttrs (resolvedTheme != null) {
    theme = resolvedTheme;
  };
in
{
  options.programs.pi = {
    enable = mkEnableOption "Pi coding agent and bundled duskpi packages";

    package = mkOption {
      type = types.package;
      default = self.packages.${pkgs.stdenv.hostPlatform.system}.default;
      description = "Pi package to install in the user environment and register in Pi settings.";
    };

    toolPackages = mkOption {
      type = types.listOf types.package;
      default = with pkgs; [
        beads
        crush
        gemini-cli
        opencode
      ];
      defaultText = lib.literalExpression "with pkgs; [ beads crush gemini-cli opencode ]";
      description = "Extra AI tooling packages installed into home.packages alongside Pi.";
    };

    defaultProvider = mkOption {
      type = types.str;
      default = "openai-codex";
      description = "Default Pi provider written to ~/.pi/agent/settings.json.";
    };

    defaultModel = mkOption {
      type = types.str;
      default = "gpt-5.4";
      description = "Default Pi model written to ~/.pi/agent/settings.json.";
    };

    settings = mkOption {
      type = types.attrs;
      default = { };
      description = "Extra settings merged into ~/.pi/agent/settings.json. This can override defaults.";
    };

    theme = mkOption {
      type = types.nullOr types.str;
      default = null;
      description = "Theme name to set in Pi settings. Ignored when programs.pi.catppuccin.enable is true.";
    };

    catppuccin = {
      enable = mkEnableOption "install and activate one of the bundled Catppuccin Pi themes";

      flavor = mkOption {
        type = types.enum [
          "latte"
          "frappe"
          "macchiato"
          "mocha"
        ];
        default = "mocha";
        description = "Catppuccin flavor to use for Pi. If catppuccin.enable is set globally, that flavor is reused.";
      };

      package = mkOption {
        type = types.package;
        default = cfg.package;
        description = "Package providing the Catppuccin Pi theme files.";
      };
    };
  };

  config = mkIf cfg.enable {
    home.packages = unique (cfg.toolPackages ++ [ cfg.package ]);

    home.file = {
      ".pi/agent/settings.json".text = builtins.toJSON (recursiveUpdate baseSettings cfg.settings);
    }
    // optionalAttrs cfg.catppuccin.enable {
      ".pi/agent/themes/catppuccin-${flavor}.json".source =
        "${cfg.catppuccin.package}/share/pi/themes/catppuccin-${flavor}.json";
    };
  };
}
