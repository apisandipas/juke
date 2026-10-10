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
      type = lib.types.str;
      example = "bparonto";
      description = ''
        Navidrome account juke acts as. Jukebox control is admin-only unless
        Navidrome's Jukebox.AdminOnly is false, so this is normally an admin.
      '';
    };

    passwordFile = lib.mkOption {
      type = lib.types.path;
      example = "/run/secrets/juke-navidrome-password";
      description = ''
        File holding that account's Navidrome password. Read through a
        systemd credential, so it can stay root-only.
      '';
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
        NAVIDROME_USER = cfg.user;
        NAVIDROME_PASSWORD_FILE = "%d/navidrome-password";
        JUKE_PORT = toString cfg.port;
        JUKE_HOST = "0.0.0.0";
        NODE_ENV = "production";
      };

      serviceConfig = {
        ExecStart = lib.getExe cfg.package;
        LoadCredential = [ "navidrome-password:${cfg.passwordFile}" ];
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
        ];
        RestrictNamespaces = true;
        LockPersonality = true;
        CapabilityBoundingSet = "";
        SystemCallArchitectures = "native";
      };
    };
  };
}
