# juke

A phone-first remote for [Navidrome](https://www.navidrome.org/)'s jukebox mode. Browse
the library from any device and the music plays on the server's speakers, not the
device in your hand.

Navidrome's web UI has no jukebox controls; Subsonic apps like DSub and Ultrasonic do,
but only on Android. juke is a small proxy plus a web app that any browser on your
network can open and add to its home screen. You run it yourself, next to your own
Navidrome.

```
phone / laptop ──SSE + JSON──▶ juke (Hono, :4600) ──Subsonic jukeboxControl──▶ Navidrome ──mpv──▶ speakers
```

## What it does

- **Remote**: now playing with cover, seek, play/pause, previous/next and volume. Every
  open tab sees the same state, pushed over server-sent events.
- **Queue**: drag to reorder (or use the keyboard), play next, remove, shuffle or
  clear what's upcoming, all without interrupting the current track.
- **Library**: search, albums (recently added, played, most played, A–Z, random),
  artists, album pages.
- **Playlists**: Navidrome playlists, played in full, shuffled, or queued. Make new ones, add songs and albums, save the queue, and rename, reorder or delete the playlists juke's account owns.
- **This device**: play on the phone or laptop holding juke instead of the jukebox, with
  lock-screen controls. Move the song, its place and the queue across in either
  direction. Plays count in Navidrome.
- **Ask** (optional): describe what you want to hear, such as "rainy Sunday, nothing with
  vocals", and get songs from your library, each with a reason. Off unless you set an
  Anthropic API key; see below.

Tapping a song opens its actions rather than playing it, because "play" replaces the
whole jukebox queue. The `+` on each row is the one-tap path: add to the end.

## Run your own

You need:

- Navidrome with jukebox mode on: `ND_JUKEBOX_ENABLED=true`. The music plays through
  the speakers of the machine Navidrome runs on.
- A Navidrome admin account for juke. Jukebox control is admin-only unless Navidrome
  runs with `ND_JUKEBOX_ADMINONLY=false`.

### Docker

```sh
docker run -d --name juke -p 4600:4600 -v juke-data:/data ghcr.io/apisandipas/juke
docker logs juke   # prints a setup code
```

Open `http://<host>:4600`, enter the setup code, and fill in your Navidrome address,
login, a name for the speakers and a juke password. juke tests the connection before
saving and says what to fix if something is wrong. [`docker-compose.yml`](docker-compose.yml)
does the same with Compose.

If Navidrome runs in the same Compose project, its address is usually
`http://navidrome:4533`; from a separate container, use the host's address, not
`localhost`.

### NixOS

```nix
# flake inputs
juke.url = "github:apisandipas/juke";

# configuration
imports = [ inputs.juke.nixosModules.default ];
services.juke = {
  enable = true;
  # Everything below is optional; leave it out to use the setup form.
  user = "admin";                                   # a Navidrome admin
  passwordFile = "/run/secrets/juke-navidrome";
  name = "Living room";
  jukePasswordFile = "/run/secrets/juke-password";
  anthropicKeyFile = "/run/secrets/juke-anthropic-key";  # turns on Ask
  # port = 4534; navidromeUrl = "http://127.0.0.1:4533";
};
networking.firewall.allowedTCPPorts = [ 4534 ];
```

With the setup form, read the setup code with `journalctl -u juke`.

### Settings

Every setting can come from an environment variable or the setup form. Environment
variables win: a field they set shows in the form as read-only, so editing your
compose file or Nix config always takes effect. The form only fills the gaps.

| Variable                 | What it sets                                           | Default                     |
| ------------------------ | ------------------------------------------------------ | --------------------------- |
| `NAVIDROME_URL`          | Navidrome's address, as juke reaches it                | `http://localhost:4533`     |
| `NAVIDROME_USER`         | Navidrome account juke uses                            |                             |
| `NAVIDROME_PASSWORD`     | That account's password                                |                             |
| `JUKE_NAME`              | What juke calls the speakers: "Playing on Living room" | `the jukebox`               |
| `JUKE_PASSWORD`          | Password each device enters once                       | none                        |
| `ANTHROPIC_API_KEY`      | Turns on Ask, using your own Anthropic account         | none: Ask is off            |
| `ANTHROPIC_MODEL`        | Claude model Ask uses                                  | `claude-opus-5-5`           |
| `JUKE_DATA_DIR`          | Where the settings file lives                          | `./data`, `/data` in Docker |
| `JUKE_PORT`, `JUKE_HOST` | Where juke listens                                     | `4600`, `0.0.0.0`           |

Any of the secrets can instead come from a file: `NAVIDROME_PASSWORD_FILE`,
`JUKE_PASSWORD_FILE`, `ANTHROPIC_API_KEY_FILE`. The Anthropic key is only read from
the environment, never saved by the form.

When `NAVIDROME_USER` and `NAVIDROME_PASSWORD` are both set, juke starts without the
setup form. When they aren't, it prints a one-time setup code in its log and asks for
it in the form, so only someone who can see the server's log can set it up.

The form saves to `settings.json` in the data folder, readable only by juke. It holds
the Navidrome password (juke needs it to sign each request) and a hash of the juke
password.

### Signing in

If juke has a password (from the form or `JUKE_PASSWORD`), each phone or browser asks
for it once and then stays signed in for 180 days. Changing the password signs every
device out. Without a password, anyone who can reach juke's port can use it, so only
skip it on a network you trust.

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

Open http://localhost:5173. To open it from another device, list that device's name
for the dev server in `JUKE_DEV_HOSTS`. The
mock (`scripts/mock-navidrome.ts`) has an invented library and a jukebox that keeps
time but makes no sound. `npm run dev:setup` runs the same mock with no settings, to
try the setup form (its settings go to `.setup-data/`; delete it to start over).

Against the real server:

```sh
cp .env.example .env   # NAVIDROME_URL, NAVIDROME_USER, NAVIDROME_PASSWORD
npm run dev
```

This drives the real jukebox: commands play out loud on the Navidrome machine.

`npm run check` runs typecheck, lint and tests. Imports use `@/` for `src/web`,
`@shared/` and `@server/` (see `aliases.ts`).

## Build

`npm run build` writes `dist/web` (static app) and `dist/server/main.js` (the proxy,
with its dependencies bundled). `node dist/server/main.js` serves both.
`docker build .` makes the same image the
[Docker workflow](.github/workflows/docker.yml) publishes on each push to `main`.

After changing dependencies, update `npmDepsHash` in `nix/package.nix` with
`nix run nixpkgs#prefetch-npm-deps package-lock.json`.

### Ask

Ask sends your request, and the titles, artists, albums, genres and years of the songs
it looks at, to Anthropic's API, billed to the key you set. Picks come only from songs
the library returned while answering; anything else is dropped. Answers are only as
good as the library's tags. At most two asks run at once.

## Limits

- One password for everyone; there are no separate juke accounts. Everyone who signs
  in controls the jukebox and browses the library as the configured Navidrome account.
- Navidrome tracks the current song by id. If the same song is queued both before and
  at the current position, a queue edit can move the "current" marker to the earlier
  copy.
- Changing settings saved by the form means editing `settings.json` (or setting the
  matching environment variable) and restarting juke. Deleting the file puts juke back
  into setup.
