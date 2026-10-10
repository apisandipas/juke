{
  lib,
  buildNpmPackage,
  nodejs_24,
  makeWrapper,
}:

buildNpmPackage {
  pname = "juke";
  version = (lib.importJSON ../package.json).version;

  src = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions [
      ../package.json
      ../package-lock.json
      ../tsconfig.json
      ../tsconfig.server.json
      ../aliases.ts
      ../vite.config.ts
      ../vite.server.config.ts
      ../src
    ];
  };

  nodejs = nodejs_24;
  # Update with: nix run nixpkgs#prefetch-npm-deps package-lock.json
  npmDepsHash = "sha256-sUL2j4slelCzNfPV4iH2RisLnFu7nHCWCw4XXKZ5Yao=";

  nativeBuildInputs = [ makeWrapper ];

  # The server build bundles its dependencies, so the output is dist/ and a
  # node binary; node_modules is not shipped.
  installPhase = ''
    runHook preInstall
    mkdir -p $out/share/juke $out/bin
    cp -r dist/server dist/web $out/share/juke/
    makeWrapper ${lib.getExe nodejs_24} $out/bin/juke \
      --add-flags $out/share/juke/server/main.js
    runHook postInstall
  '';

  meta = {
    description = "Phone-first remote for Navidrome's jukebox mode";
    mainProgram = "juke";
    platforms = lib.platforms.linux;
  };
}
