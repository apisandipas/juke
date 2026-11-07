# NixOS module for juke. Runs next to Navidrome and talks to it over
# loopback; browsers reach juke on `port`.
self:
{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.services.juke;
in
{
  options.services.juke = {
    enable = lib.mkEnableOption "juke, a remote for Navidrome's jukebox mode";

    package = lib.mkOption {
      type = lib.types.package;
      default = self.packages.${pkgs.stdenv.hostPlatform.system}.default;
      description = "The juke package to run.";
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 4534;
      description = "Port juke listens on, on all interfaces. Gate access with the firewall.";
    };

    navidromeUrl = lib.mkOption {
      type = lib.types.str;
      default = "http://127.0.0.1:4533";
      description = "Base URL of the Navidrome server.";
    };

    user = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      example = "admin";
      description = ''
        Navidrome account juke acts as. Jukebox control is admin-only unless
        Navidrome's Jukebox.AdminOnly is false, so this is normally an admin.
        Leave null to enter it in juke's setup form instead.
      '';
    };

    passwordFile = lib.mkOption {
      type = lib.types.nullOr lib.types.path;
      default = null;
      example = "/run/secrets/juke-navidrome-password";
      description = ''
        File holding that account's Navidrome password. Read through a
        systemd credential, so it can stay root-only. Leave null to enter
        it in juke's setup form instead.
      '';
    };

    name = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      example = "Living room";
      description = ''What juke calls the speakers ("Playing on Living room").'';
    };

    jukePasswordFile = lib.mkOption {
      type = lib.types.nullOr lib.types.path;
      default = null;
      example = "/run/secrets/juke-password";
      description = ''
        File holding the password each device enters once to use juke.
        With this null and the Navidrome login set here, juke has no
        password and anyone who can reach the port can use it. When juke is
        set up through its form, the form sets the password instead.
      '';
    };

    anthropicKeyFile = lib.mkOption {
      type = lib.types.nullOr lib.types.path;
      default = null;
      example = "/run/secrets/juke-anthropic-key";
      description = ''
        File holding an Anthropic API key. Turns on Ask, which picks songs
        from the library for a request in plain words. Read through a
        systemd credential, so it can stay root-only. Leave null to keep
        Ask off.
      '';
    };

    anthropicModel = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      example = "claude-sonnet-5-5";
      description = "Claude model Ask uses. Null means juke's default, Claude Opus 5.5.";
    };
  };

  config = lib.mkIf cfg.enable {
    systemd.services.juke = {
      description = "juke, Navidrome jukebox remote";
      after = [
        "network.target"
        "navidrome.service"
      ];
      wantedBy = [ "multi-user.target" ];

      environment = {
        NAVIDROME_URL = cfg.navidromeUrl;
        JUKE_PORT = toString cfg.port;
        JUKE_HOST = "0.0.0.0";
        NODE_ENV = "production";
      }
      // lib.optionalAttrs (cfg.user != null) { NAVIDROME_USER = cfg.user; }
      // lib.optionalAttrs (cfg.passwordFile != null) {
        NAVIDROME_PASSWORD_FILE = "%d/navidrome-password";
      }
      // lib.optionalAttrs (cfg.name != null) { JUKE_NAME = cfg.name; }
      // lib.optionalAttrs (cfg.jukePasswordFile != null) {
        JUKE_PASSWORD_FILE = "%d/juke-password";
      }
      // lib.optionalAttrs (cfg.anthropicKeyFile != null) {
        ANTHROPIC_API_KEY_FILE = "%d/anthropic-key";
      }
      // lib.optionalAttrs (cfg.anthropicModel != null) { ANTHROPIC_MODEL = cfg.anthropicModel; };

      serviceConfig = {
        # Settings from the setup form, and the key that signs sign-ins.
        # juke finds it through STATE_DIRECTORY.
        StateDirectory = "juke";
        StateDirectoryMode = "0700";
        ExecStart = lib.getExe cfg.package;
        LoadCredential =
          lib.optional (cfg.passwordFile != null) "navidrome-password:${cfg.passwordFile}"
          ++ lib.optional (cfg.jukePasswordFile != null) "juke-password:${cfg.jukePasswordFile}"
          ++ lib.optional (cfg.anthropicKeyFile != null) "anthropic-key:${cfg.anthropicKeyFile}";
        Restart = "on-failure";
        RestartSec = 2;

        DynamicUser = true;
        NoNewPrivileges = true;
        PrivateTmp = true;
        PrivateDevices = true;
        ProtectSystem = "strict";
        ProtectHome = true;
        ProtectKernelTunables = true;
        ProtectKernelModules = true;
        ProtectControlGroups = true;
        RestrictAddressFamilies = [
          "AF_INET"
          "AF_INET6"
          # Name lookups go through nscd's socket; Ask resolves api.anthropic.com.
          "AF_UNIX"
        ];
        RestrictNamespaces = true;
        LockPersonality = true;
        CapabilityBoundingSet = "";
        SystemCallArchitectures = "native";
      };
    };
  };
}
