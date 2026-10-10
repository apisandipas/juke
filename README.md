# juke

A phone-first remote for [Navidrome](https://www.navidrome.org/)'s jukebox mode. Browse
the library from any device and the music plays on the server's speakers, not the
device in your hand.

Navidrome's web UI has no jukebox controls; Subsonic apps like DSub and Ultrasonic do,
but only on Android. juke is a small proxy plus a web app that any browser on the
tailnet can open and add to its home screen.

```
phone / laptop ──SSE + JSON──▶ juke (Hono, :4534) ──Subsonic jukeboxControl──▶ Navidrome ──mpv──▶ speakers
```

## What it does

- **Remote**: now playing with cover, seek, play/pause, previous/next and volume. Every
  open tab sees the same state, pushed over server-sent events.
- **Queue**: drag to reorder (or use the keyboard), play next, remove, shuffle or
  clear what's upcoming, all without interrupting the current track.
- **Library**: search, albums (recently added, played, most played, A–Z, random),
  artists, album pages.
- **Playlists**: Navidrome playlists, played in full, shuffled, or queued.

Tapping a song opens its actions rather than playing it, because "play" replaces the
whole jukebox queue. The `+` on each row is the one-tap path: add to the end.

## How the proxy works

The browser never talks to Navidrome directly. The proxy holds the credentials (token
auth, a fresh salt per request), polls `jukeboxControl` about once a second while any
tab is open, and fans the state out to every tab.

Navidrome 0.64's jukebox has no insert or move action, and `set` stops the playing
track. So "play next", reordering, shuffle and clear all rewrite only the tracks
_after_ the current one: remove them from the end, then add the new tail.
`src/server/jukebox.ts` has the details, and `src/server/jukebox.test.ts` checks it
against a fake that follows Navidrome's queue semantics.

## Develop

```sh
npm install
npm run dev:mock   # mock Navidrome + proxy + Vite; nothing plays anywhere
```

Open http://localhost:5173 (or `http://madrox:5173` from another tailnet device). The
mock (`scripts/mock-navidrome.ts`) has an invented library and a jukebox that keeps
time but makes no sound.

Against the real server:

```sh
cp .env.example .env   # NAVIDROME_URL, NAVIDROME_USER, NAVIDROME_PASSWORD
npm run dev
```

This drives the real jukebox. Commands play out loud on Galactus.

`npm run check` runs typecheck, lint and tests. Imports use `@/` for `src/web`,
`@shared/` and `@server/` (see `aliases.ts`).

## Build and deploy

`npm run build` writes `dist/web` (static app) and `dist/server/main.js` (the proxy,
with its dependencies bundled). `node dist/server/main.js` serves both.

On NixOS, use the flake:

```nix
# flake inputs
juke.url = "github:apisandipas/juke";

# configuration
imports = [ inputs.juke.nixosModules.default ];
services.juke = {
  enable = true;
  user = "bparonto";                         # a Navidrome admin: jukebox is admin-only
  passwordFile = "/run/secrets/juke-navidrome";
  # port = 4534; navidromeUrl = "http://127.0.0.1:4533";
};
networking.firewall.interfaces.tailscale0.allowedTCPPorts = [ 4534 ];
```

After changing dependencies, update `npmDepsHash` in `nix/package.nix` with
`nix run nixpkgs#prefetch-npm-deps package-lock.json`.

## Limits

- No sign-in of its own. Anyone who can reach the port controls the jukebox and browses
  the library as the configured account. Keep it on the tailnet.
- Navidrome tracks the current song by id. If the same song is queued both before and
  at the current position, a queue edit can move the "current" marker to the earlier
  copy.
- On Galactus, jukebox audio goes through bryan's PipeWire session, so it only plays
  while bryan is logged in (see the Navidrome module in the nix config).
