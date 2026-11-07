# Lyrics+

A local-first desktop music player for Linux with Lyrics Plus–style karaoke
animations. Built with **Electron 45 (Chromium)**, **React 18**,
**TypeScript**, **Tailwind**, **framer-motion** and **Zustand**.

![Lyrics+](assets/icon.png)

Chromium decodes FLAC, ALAC, WAV, MP3, Opus, OGG and AAC natively and routes
them through PipeWire/PulseAudio. No WebKitGTK compositor spin, no libmpv.

## Features

- **Hardware-accelerated playback** — Chromium media pipeline, FLAC / Hi-Res
  FLAC / ALAC / WAV / MP3 / OPUS / OGG / M4A / AAC.
- **Karaoke lyrics** — line-by-line and word-by-word sweep, click any line to
  seek, smooth centered scrolling, fade-out blur.
- **Lucid UI** — frosted-glass surfaces, cover-colored ambient glow, optional
  noise overlay, frameless window with custom controls.
- **Full settings panel** — lyrics timing offset, font size, alignment,
  transparency, compact lyric window, palette colors, ambient/noise toggles.
- **Provider pipeline** — enable, reorder and prioritize lyric sources:
  LRCLIB, Spotify (sp_dc cookie), Musixmatch (API key / refresh token) and
  embedded tags. Local `.lrc` sidecars always win.
- **Local library scanner** — `music-metadata` reads tags, embedded covers and
  lyrics. Covers are cached under the Electron user-data directory.
- **Browser preview** — the UI runs in a normal browser with a demo library and
  simulated playback.

## Requirements

- Linux with PipeWire, PulseAudio or ALSA (Wayland or X11)
- Node.js 18+ and npm
- No Rust toolchain required

## Run

```bash
npm install
npm run dev
```

`npm run dev` starts Vite and launches Electron automatically.

### Browser preview

Open `http://localhost:1420` while Vite runs. The title bar shows a **Preview**
badge and the app uses a demo library. No audio is produced in the browser.

### Production build

```bash
npm run build        # typecheck + Vite + electron-builder
npm run build:app    # typecheck + Vite only
npm run dist         # electron-builder (AppImage + deb)
```

Bundles are written under `release/`.

## Using the app

1. Click **Add music folder** (or **Add folder** in the library header) and pick
   a directory. The scanner walks it recursively.
2. Click a track to start playback and open the karaoke view.
3. Drop a `.lrc` file next to an audio file to use local synced lyrics. Enhanced
   LRC word tags (`<mm:ss.xx>`) are supported.
4. Open **Settings** (gear icon in the sidebar footer) to tune lyrics and
   providers.

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Space` | Play / pause |
| `←` / `→` | Seek −5 s / +5 s (`Shift` = 15 s) |
| `↑` / `↓` | Volume ±5% |
| `N` / `P` | Next / previous track |
| `M` | Mute |
| `F` | Immersive lyrics (hide side panels) |
| `Q` | Toggle queue |
| `L` | Toggle Library / Now Playing |
| `/` | Jump to library search |
| `Esc` | Close queue / settings or exit immersive mode |

## Settings

Settings are stored in `library.json` in Electron's user-data directory
(`~/.config/lyrics-plus-player/library.json` on Linux) and applied instantly.

### Lyrics & Display

- **Global delay** — −2000…+2000 ms timing offset for karaoke.
- **Karaoke font size** — 32–64 px.
- **Alignment** — left, center or right.
- **Transparency** — overall lyrics opacity.
- **Compact synced mode** — lines before/after the active line plus optional
  fade-out blur.
- **Visuals** — colorful ambient background, noise overlay, ambient intensity
  and custom active/inactive/accent colors.

### Providers

Providers are queried top to bottom. Use the arrows to reorder and the checkbox
to enable/disable. The first provider with lyrics wins.

1. **LRCLIB** — free, no key required.
2. **Spotify** — requires the `sp_dc` cookie of a logged-in account. The app
   resolves the track through the Spotify search API and reads Color Lyrics.
3. **Musixmatch** — developer API key or refresh token.
4. **Embedded tags** — FLAC Vorbis `LYRICS`, ID3 `USLT`/`SYLT`.

Local `.lrc` sidecars are checked before any provider. A failed online lookup
never blocks playback.

## Architecture

```
electron/
  main.ts        window, IPC, dialogs, media:// protocol, resize handles
  preload.ts     sandboxed contextBridge API (CommonJS)
  scanner.ts     music-metadata scanner, stable 52-bit ids, cover cache
  lyrics.ts      sidecar → provider pipeline → JSON cache
  media.ts       media:// audio + cover protocol with Range support
  store.ts       library/settings/lyrics JSON persistence
src/
  App.tsx        app shell, view transitions, shortcuts
  components/
    background/  cover-colored ambient background, noise overlay
    layout/      custom titlebar, sidebar
    library/     library grid, track rows
    lyrics/      tabs, line animations, centered scroller
    player/      now playing view/panel, player bar, queue
    settings/    Options & Providers modal
    ui/          cover art, buttons, toaster, equalizer
  hooks/         smooth 60 fps position, cover palette
  lib/           Electron bridge, AudioEngine, LRC parser, colors
  store/         Zustand player, settings and toast stores
```

### Playback contract

The renderer owns playback through a single `HTMLAudioElement`. It emits a
snapshot every 33 ms with
`{ path, positionMs, durationMs, paused, volume, eof, bitPerfect }`;
`ended` fires once per track. The main process only handles files, dialogs,
scanning, lyrics and the `media://` protocol.

Track IDs are stable 52-bit FNV-1a hashes of the file path. Cover art is written
to `$XDG_CONFIG_HOME/lyrics-plus-player/covers` and served through `media://`.

## Notes

- **Frameless window** — drag from the title bar, resize from any edge.
- **Wayland** — Chromium starts with `UseOzonePlatform` and
  `--ozone-platform=wayland` when `WAYLAND_DISPLAY` is set.
- **Sandbox** — `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true`; the preload is bundled as CommonJS.
- **Legacy Tauri backend** — archived under `legacy-tauri/` for reference only.

## Troubleshooting

- **Blank window** — run `npm run dev` and check the terminal; the renderer log
  is forwarded in development.
- **Covers missing** — only embedded artwork is extracted. Embed art in the file
  or extend `electron/scanner.ts`.
- **No online lyrics** — check network access to `lrclib.net`; requests carry a
  descriptive `User-Agent`. Enable the providers you want in Settings.
- **Spotify provider empty** — `sp_dc` cookies expire; paste a fresh value.
