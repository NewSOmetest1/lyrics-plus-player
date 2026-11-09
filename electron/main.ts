import { mkdirSync, promises as fs, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  screen,
  session,
  shell,
  type IpcMainInvokeEvent,
  type Point,
  type Rectangle,
} from "electron";

import { resolveLyrics, testProvider, type TestProviderId } from "./lyrics";
import * as spotifyAuth from "./spotify-auth.cjs";
import { registerMediaProtocol, registerMediaScheme } from "./media";
import {
  destroyDiscordRpc,
  initDiscordRpc,
  updateDiscordRpc,
  type DiscordPresencePayload,
} from "./discord";
import {
  defaultM3UFileName,
  parseM3U,
  PlaylistStore,
  playlistNameFromM3U,
  serializeM3U,
  type PlaylistCreateInput,
  type PlaylistUpdateInput,
} from "./playlists";
import {
  coverFileNameFromUrl,
  defaultMusicDir,
  ensureCoverVariantsFromFile,
  isCoverVariantFileName,
  scanLibrary,
} from "./scanner";
import { StatsStore } from "./stats";
import { LibraryStore } from "./store";
import { TrackDelayStore } from "./trackDelays";
import {
  DownloadManager,
  resolveDownloaderSettings,
} from "./downloader";
import { ReleasesStore, resolvePreviewUrl } from "./releases";
import { SpotifyLikedStore } from "./spotify-liked";
import { SpotifyCatalogService } from "./spotify-catalog";
import type {
  DownloadRequest,
  MusicFolder,
  MusicFolderAddResult,
  MusicFolderRemoveResult,
  MusicFolderRescanResult,
  ScanProgress,
} from "./types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Opt-in startup timings. Disabled by default; zero behavioral impact.
const PERF_ENABLED = process.env.LYRICS_PERF === "1";
const PERF_STARTED_AT = performance.now();

function perfMark(name: string): void {
  if (!PERF_ENABLED) return;
  console.log(`[perf] ${name} ${(performance.now() - PERF_STARTED_AT).toFixed(1)}ms`);
}

if (process.platform === "linux" && process.env.WAYLAND_DISPLAY) {
  app.commandLine.appendSwitch("enable-features", "UseOzonePlatform,WaylandWindowDecorations");
  app.commandLine.appendSwitch("ozone-platform", "wayland");
}

if (process.env.LYRICS_PLUS_DEBUG_PORT) {
  app.commandLine.appendSwitch("remote-debugging-port", process.env.LYRICS_PLUS_DEBUG_PORT);
}

registerMediaScheme();

let mainWindow: BrowserWindow | null = null;
let store: LibraryStore;
let playlists: PlaylistStore;
let stats: StatsStore;
let trackDelays: TrackDelayStore;
let releases: ReleasesStore;
let spotifyLiked: SpotifyLikedStore;
let spotifyCatalog: SpotifyCatalogService;
let downloads: DownloadManager;

/**
 * Fill fileName/mtime for libraries created before AIMP sorting existed, so
 * "File modified" uses the real disk timestamp on the very first run.
 */
async function backfillFileMetadata(): Promise<void> {
  const missing = store.getTracksMissingFileMetadata();
  if (missing.length === 0) return;

  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < missing.length) {
      const track = missing[cursor];
      cursor += 1;
      try {
        const info = await fs.stat(track.path);
        store.setFileMetadata(track.path, path.basename(track.path), info.mtimeMs);
      } catch {
        // Missing files are ignored here; the playlist will show them as stale.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(16, missing.length) }, worker));
  store.save();
}

const COVER_MIGRATION_IDLE_MS = 200;

/**
 * Rebuild card/display variants for covers written before content-addressed
 * names existed. Runs long after the window is visible and yields between
 * covers so media:// responses and playback never queue behind image work.
 * Generated files are content-addressed, so rerunning after an interrupted
 * pass is a no-op. Originals are never deleted.
 */
async function migrateCoverVariants(): Promise<void> {
  const pending = store.getTracks().filter((track) => {
    const card = coverFileNameFromUrl(track.coverPath);
    const display = coverFileNameFromUrl(track.coverFullPath);
    return (
      (card !== null && !isCoverVariantFileName(card)) ||
      (display !== null && !isCoverVariantFileName(display))
    );
  });
  perfMark(`cover-migration-start ${pending.length}`);
  if (pending.length === 0) return;

  let changed = 0;
  for (const track of pending) {
    const cardFile = coverFileNameFromUrl(track.coverPath);
    if (!cardFile) continue;
    // Prefer an existing palette source; otherwise the current (original)
    // cover keeps the exact accent colors the old full-size sample produced.
    const paletteSource = track.coverPalettePath ?? track.coverPath;
    const variants = ensureCoverVariantsFromFile(coversDir, cardFile);
    if (!variants) continue;

    const displayFile = coverFileNameFromUrl(track.coverFullPath);
    const displayVariants =
      displayFile && displayFile !== cardFile
        ? ensureCoverVariantsFromFile(coversDir, displayFile)
        : null;

    store.setTrackCoverPaths(
      track.id,
      variants.card,
      displayVariants?.display ?? variants.display,
      paletteSource,
    );
    changed += 1;

    // Checkpoint so an interrupted migration keeps finished work. Rare enough
    // (every 100 covers) not to matter for playback.
    if (changed % 100 === 0) store.save();

    // A single large cover decode can take hundreds of milliseconds. Give the
    // event loop a long gap after every file so audio and IPC stay responsive.
    await new Promise<void>((resolve) =>
      setTimeout(resolve, COVER_MIGRATION_IDLE_MS),
    );
  }

  if (changed > 0) {
    store.save();
    // Renderer keeps the old (still valid) URLs until the next library
    // refresh so migration cannot flash artwork mid-playback.
  }
  perfMark(`cover-migration-done ${changed}`);
}

function readStatsPayload(payload: unknown): {
  trackPath: string;
  durationSec: number;
} {
  if (typeof payload === "string") {
    return { trackPath: payload, durationSec: 0 };
  }
  const record = (payload ?? {}) as {
    trackPath?: unknown;
    path?: unknown;
    durationSec?: unknown;
    seconds?: unknown;
  };
  const trackPath =
    typeof record.trackPath === "string"
      ? record.trackPath
      : typeof record.path === "string"
        ? record.path
        : "";
  const duration = Number(record.durationSec ?? record.seconds ?? 0);
  return {
    trackPath,
    durationSec: Number.isFinite(duration) ? Math.max(0, duration) : 0,
  };
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
}

function send(channel: string, payload?: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1400,
    height: 880,
    minWidth: 1080,
    minHeight: 700,
    frame: false,
    title: "Lyrics+",
    backgroundColor: "#070708",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });

  window.once("ready-to-show", () => {
    perfMark("ready-to-show");
    window.show();
  });
  window.on("maximize", () => window.webContents.send("window:maximized", true));
  window.on("unmaximize", () => window.webContents.send("window:maximized", false));
  window.on("app-command", (_event, command) => {
    if (command === "browser-backward") {
      window.webContents.send("nav:back");
    } else if (command === "browser-forward") {
      window.webContents.send("nav:forward");
    }
  });
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    void window.loadURL(devUrl);
  } else {
    void window.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  if (!app.isPackaged) {
    window.webContents.on("console-message", (details) => {
      console.log(`[renderer:${details.level}] ${details.message}`);
    });
  }

  return window;
}

let resizeTimer: NodeJS.Timeout | null = null;
let resizeSession:
  | { window: BrowserWindow; direction: string; start: Point; bounds: Rectangle }
  | null = null;

function stopResize(): void {
  if (resizeTimer) clearInterval(resizeTimer);
  resizeTimer = null;
  resizeSession = null;
}

function startResize(event: IpcMainInvokeEvent, direction: string): void {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || window.isMaximized() || window.isFullScreen()) return;
  stopResize();
  resizeSession = {
    window,
    direction,
    start: screen.getCursorScreenPoint(),
    bounds: window.getBounds(),
  };
  resizeTimer = setInterval(() => {
    const session = resizeSession;
    if (!session || session.window.isDestroyed()) {
      stopResize();
      return;
    }
    const point = screen.getCursorScreenPoint();
    const dx = point.x - session.start.x;
    const dy = point.y - session.start.y;
    const { direction: dir, bounds } = session;

    let { x, y, width, height } = bounds;
    if (dir.includes("East")) width = bounds.width + dx;
    if (dir.includes("West")) width = bounds.width - dx;
    if (dir.includes("South")) height = bounds.height + dy;
    if (dir.includes("North")) height = bounds.height - dy;

    width = Math.max(1080, width);
    height = Math.max(700, height);
    if (dir.includes("West")) x = bounds.x + bounds.width - width;
    if (dir.includes("North")) y = bounds.y + bounds.height - height;

    session.window.setBounds({ x, y, width, height });
  }, 16);
}

async function spotifyStatusPayload(): Promise<{
  authenticated: boolean;
  hasSpDc: boolean;
  hasSpKey: boolean;
}> {
  const cookies = await spotifyAuth.readSpotifyCookies(session.defaultSession);
  const storedDc = store.getSetting("spotify_sp_dc")?.trim() ?? "";
  const storedKey = store.getSetting("spotify_sp_key")?.trim() ?? "";
  return {
    authenticated: Boolean(
      (cookies.spDc && cookies.spKey) || (storedDc && storedKey),
    ),
    hasSpDc: Boolean(cookies.spDc || storedDc),
    hasSpKey: Boolean(cookies.spKey || storedKey),
  };
}

function musicFolderSnapshot(): MusicFolder[] {
  return store.getMusicFolders().map((folderPath) => ({
    path: folderPath,
    trackCount: store.countTracksInFolder(folderPath),
  }));
}

function registerIpc(): void {
  ipcMain.handle("get_tracks", () => store.getTracks());
  ipcMain.handle("get_track", (_event, trackId: number) => store.getTrack(trackId) ?? null);

  ipcMain.handle("scan_library", async (event, paths: string[]) => {
    const roots = Array.isArray(paths) && paths.length > 0 ? paths : [defaultMusicDir()];
    const sender = event.sender;
    return scanLibrary(store, coversDir, roots, (progress: ScanProgress) => {
      if (!sender.isDestroyed()) sender.send("scan-progress", progress);
    });
  });

  ipcMain.handle("folders:get", () => musicFolderSnapshot());

  ipcMain.handle("folders:add", async (event): Promise<MusicFolderAddResult> => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.OpenDialogOptions = {
      title: "Add music folder",
      buttonLabel: "Add folder",
      properties: ["openDirectory"],
    };
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) {
      return {
        cancelled: true,
        alreadyExists: false,
        folders: musicFolderSnapshot(),
        summary: null,
      };
    }

    const folderPath = path.resolve(result.filePaths[0]);
    if (!store.addMusicFolder(folderPath)) {
      return {
        cancelled: false,
        alreadyExists: true,
        folders: musicFolderSnapshot(),
        summary: null,
      };
    }

    const sender = event.sender;
    const summary = await scanLibrary(
      store,
      coversDir,
      [folderPath],
      (progress: ScanProgress) => {
        if (!sender.isDestroyed()) sender.send("scan-progress", progress);
      },
    );
    return {
      cancelled: false,
      alreadyExists: false,
      folders: musicFolderSnapshot(),
      summary,
    };
  });

  ipcMain.handle(
    "folders:remove",
    (_event, folderPath: unknown): MusicFolderRemoveResult => {
      if (typeof folderPath !== "string" || folderPath.trim() === "") {
        throw new Error("A folder path is required");
      }
      const removedTracks = store.removeMusicFolder(folderPath);
      return { folders: musicFolderSnapshot(), removedTracks };
    },
  );

  ipcMain.handle(
    "folders:rescan",
    async (event): Promise<MusicFolderRescanResult> => {
      const roots = store.getMusicFolders();
      if (roots.length === 0) {
        return { folders: [], summary: null };
      }
      const sender = event.sender;
      const summary = await scanLibrary(
        store,
        coversDir,
        roots,
        (progress: ScanProgress) => {
          if (!sender.isDestroyed()) sender.send("scan-progress", progress);
        },
      );
      return { folders: musicFolderSnapshot(), summary };
    },
  );

  ipcMain.handle(
    "get_lyrics",
    async (_event, payload: { trackId: number; force?: boolean }) => {
      const track = store.getTrack(payload.trackId);
      if (!track) throw new Error("Track not found");
      return resolveLyrics(store, track, Boolean(payload.force));
    },
  );

  ipcMain.handle(
    "test_provider",
    (
      _event,
      payload: { provider: TestProviderId; spDc?: string; spKey?: string },
    ) => {
      return testProvider(store, payload.provider, {
        spDc: payload.spDc,
        spKey: payload.spKey,
      });
    },
  );

  ipcMain.handle("spotify:login", async () => {
    const result = await spotifyAuth.loginSpotify(
      { BrowserWindow, session, parent: mainWindow },
      store,
      (payload) => send("spotify:auth-success", payload),
    );
    if (!result.ok) return result;

    // The frontend gets the success event immediately; the provider test runs
    // in the background so the login window is never held open by Spotify's
    // color-lyrics request.
    void testProvider(store, "spotify", {
      spDc: result.spDc,
      spKey: result.spKey,
    })
      .then((test) => send("spotify:auth-test", test))
      .catch((error) => {
        send("spotify:auth-test", {
          provider: "spotify",
          ok: false,
          status: null,
          statusText: "ERROR",
          lines: 0,
          synced: false,
          sample: [],
          message: error instanceof Error ? error.message : String(error),
        });
      });
    return result;
  });

  ipcMain.handle("spotify:logout", async () => {
    await spotifyAuth.logoutSpotify({ session });
    store.setSetting("spotify_sp_dc", "");
    store.setSetting("spotify_sp_key", "");
    spotifyAuth.clearSpotifyTokenCache();
    send("spotify:auth-logout", { ok: true });
    return { ok: true };
  });

  ipcMain.handle("spotify:status", () => spotifyStatusPayload());

  ipcMain.handle("spotify-liked:get", async () => {
    const status = await spotifyStatusPayload();
    return spotifyLiked.getSnapshot(status.authenticated);
  });

  ipcMain.handle("spotify-liked:sync", async () => {
    const status = await spotifyStatusPayload();
    return spotifyLiked.sync(
      { BrowserWindow, session },
      store,
      status.authenticated,
    );
  });

  ipcMain.handle("spotify-liked:set", async (_event, payload: unknown) => {
    const record = (payload ?? {}) as {
      trackId?: unknown;
      liked?: unknown;
    };
    if (typeof record.trackId !== "string" || !record.trackId.trim()) {
      throw new Error("A Spotify track id is required.");
    }
    const status = await spotifyStatusPayload();
    return spotifyLiked.setLiked(
      { BrowserWindow, session },
      store,
      record.trackId,
      Boolean(record.liked),
      status.authenticated,
    );
  });

  ipcMain.handle("spotify:search", async (_event, query: unknown) => {
    if (typeof query !== "string") {
      throw new Error("A search query is required.");
    }
    return spotifyCatalog.search(query);
  });

  ipcMain.handle("spotify:artist", async (_event, payload: unknown) => {
    const record = (payload ?? {}) as {
      artistId?: unknown;
      name?: unknown;
    };
    const artistId =
      typeof record.artistId === "string" ? record.artistId.trim() : "";
    const name = typeof record.name === "string" ? record.name.trim() : "";
    if (!artistId && !name) {
      throw new Error("An artist id or name is required.");
    }
    return spotifyCatalog.artist(artistId, name || undefined);
  });

  ipcMain.handle("spotify:albumTracks", async (_event, payload: unknown) => {
    const record = (payload ?? {}) as {
      albumId?: unknown;
      artist?: unknown;
      album?: unknown;
      coverUrl?: unknown;
    };
    if (typeof record.albumId !== "string" || !record.albumId.trim()) {
      throw new Error("An album id is required.");
    }
    return spotifyCatalog.albumTracks(record.albumId, {
      artist: typeof record.artist === "string" ? record.artist : undefined,
      album: typeof record.album === "string" ? record.album : undefined,
      coverUrl:
        typeof record.coverUrl === "string" ? record.coverUrl : undefined,
    });
  });

  ipcMain.handle("spotify:album", async (_event, payload: unknown) => {
    const record = (payload ?? {}) as {
      albumId?: unknown;
      artist?: unknown;
      album?: unknown;
      coverUrl?: unknown;
      releaseDate?: unknown;
      totalTracks?: unknown;
    };
    if (typeof record.albumId !== "string" || !record.albumId.trim()) {
      throw new Error("An album id is required.");
    }
    return spotifyCatalog.album(record.albumId, {
      artist: typeof record.artist === "string" ? record.artist : undefined,
      album: typeof record.album === "string" ? record.album : undefined,
      coverUrl:
        typeof record.coverUrl === "string" ? record.coverUrl : undefined,
      releaseDate:
        typeof record.releaseDate === "string" ? record.releaseDate : undefined,
      totalTracks:
        typeof record.totalTracks === "number"
          ? record.totalTracks
          : undefined,
    });
  });

  ipcMain.handle("spotify:resolveArtist", async (_event, name: unknown) => {
    if (typeof name !== "string" || !name.trim()) return null;
    return spotifyCatalog.resolveArtist(name);
  });

  ipcMain.handle("releases:get", async () => {
    const status = await spotifyStatusPayload();
    return releases.getFeed(status.authenticated);
  });

  ipcMain.handle("releases:preview", (_event, trackId: unknown) => {
    return typeof trackId === "string"
      ? resolvePreviewUrl(trackId)
      : Promise.resolve(null);
  });

  ipcMain.handle("releases:sync", async () => {
    const feed = await releases.sync(
      { BrowserWindow, session },
      store,
    );
    const status = await spotifyStatusPayload();
    return { ...feed, authenticated: status.authenticated };
  });

  ipcMain.handle(
    "releases:setFollow",
    async (
      _event,
      payload: { name?: unknown; following?: unknown },
    ) => {
      const feed = await releases.setFollow(
        { BrowserWindow, session },
        store,
        payload ?? {},
      );
      const status = await spotifyStatusPayload();
      return { ...feed, authenticated: status.authenticated };
    },
  );

  ipcMain.handle("downloads:get", () => downloads.getSnapshot());
  ipcMain.handle("downloads:start", (_event, requests: unknown) => {
    if (!Array.isArray(requests)) return downloads.getSnapshot();
    return downloads.start(requests as DownloadRequest[]);
  });
  ipcMain.handle("downloads:cancel", (_event, taskId: unknown) => {
    if (typeof taskId !== "string") return downloads.getSnapshot();
    return downloads.cancel(taskId);
  });
  ipcMain.handle("downloads:clearCompleted", () =>
    downloads.clearCompleted(),
  );

  ipcMain.handle("get_default_music_dir", () => defaultMusicDir());

  ipcMain.handle("get_setting", (_event, key: string) => store.getSetting(key) ?? null);
  ipcMain.handle(
    "set_setting",
    (_event, payload: { key: string; value: string }) => {
      store.setSetting(payload.key, payload.value);
      if (payload.key === "discord_client_id") {
        initDiscordRpc(process.env.LYRICS_PLUS_DISCORD_CLIENT_ID || payload.value);
      }
    },
  );

  ipcMain.handle("stats:get", () => stats.get());
  ipcMain.handle("stats:trackPlayed", (_event, payload: unknown) => {
    const { trackPath, durationSec } = readStatsPayload(payload);
    return stats.trackPlayed(trackPath, durationSec);
  });
  ipcMain.handle("stats:addListenTime", (_event, payload: unknown) => {
    const { trackPath, durationSec } = readStatsPayload(payload);
    return stats.addListenTime(trackPath, durationSec);
  });

  ipcMain.handle("track_delays:getAll", () => trackDelays.getAll());
  ipcMain.handle(
    "track_delays:set",
    (_event, payload: { trackPath?: unknown; offsetMs?: unknown }) =>
      trackDelays.set(
        typeof payload?.trackPath === "string" ? payload.trackPath : "",
        payload?.offsetMs,
      ),
  );
  ipcMain.handle("track_delays:reset", (_event, trackPath: unknown) => {
    if (typeof trackPath === "string") trackDelays.reset(trackPath);
  });
  ipcMain.handle("track_delays:resetAll", () => trackDelays.resetAll());

  ipcMain.handle("discord:update", (_event, presence: DiscordPresencePayload | null) => {
    updateDiscordRpc(presence);
  });
  ipcMain.handle("remove_track", (_event, trackId: number) => store.removeTrack(trackId));
  ipcMain.handle("clear_lyrics_cache", (_event, trackId: number) => store.clearLyrics(trackId));

  ipcMain.handle("playlists:getAll", () => playlists.getAll());

  ipcMain.handle("playlists:ensureLiked", () => playlists.ensureLiked());

  ipcMain.handle("playlists:create", (_event, input: PlaylistCreateInput) =>
    playlists.create(input),
  );

  ipcMain.handle(
    "playlists:update",
    (_event, payload: PlaylistUpdateInput & { id: string }) => {
      const { id, ...patch } = payload;
      return playlists.update(id, patch);
    },
  );

  ipcMain.handle("playlists:delete", (_event, playlistId: string) =>
    playlists.delete(playlistId),
  );

  ipcMain.handle(
    "playlists:addTrack",
    (_event, payload: { playlistId: string; trackPath: string }) =>
      playlists.addTrack(payload.playlistId, payload.trackPath),
  );

  ipcMain.handle(
    "playlists:removeTrack",
    (_event, payload: { playlistId: string; trackPath: string }) =>
      playlists.removeTrack(payload.playlistId, payload.trackPath),
  );

  ipcMain.handle("playlists:importM3U", async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.OpenDialogOptions = {
      title: "Import M3U playlist",
      properties: ["openFile"],
      filters: [{ name: "M3U playlists", extensions: ["m3u", "m3u8"] }],
    };
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return null;

    const source = result.filePaths[0];
    const content = readFileSync(source, "utf8");
    const trackPaths = parseM3U(content, path.dirname(source));
    return playlists.create({
      name: playlistNameFromM3U(content, source),
      trackPaths,
    });
  });

  ipcMain.handle("playlists:exportM3U", async (event, playlistId: string) => {
    const playlist = playlists.get(playlistId);
    if (!playlist) throw new Error("Playlist not found");

    const window = BrowserWindow.fromWebContents(event.sender);
    let defaultDir = app.getPath("documents");
    try {
      defaultDir = app.getPath("music");
    } catch {
      // Music directory may not exist on minimal Linux installs.
    }
    const options = {
      title: "Export playlist as M3U",
      defaultPath: path.join(defaultDir, defaultM3UFileName(playlist.name)),
      filters: [{ name: "M3U playlist", extensions: ["m3u"] }],
    };
    const result = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return null;

    const target = /\.m3u8?$/i.test(result.filePath)
      ? result.filePath
      : `${result.filePath}.m3u`;
    writeFileSync(target, serializeM3U(playlist), "utf8");
    return target;
  });

  ipcMain.handle("dialog:select_folder", async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const result = window
      ? await dialog.showOpenDialog(window, {
          title: "Add music folder",
          properties: ["openDirectory"],
        })
      : await dialog.showOpenDialog({ title: "Add music folder", properties: ["openDirectory"] });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle("window:minimize", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });
  ipcMain.handle("window:toggle_maximize", (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return;
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  });
  ipcMain.handle("window:close", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });
  ipcMain.handle("window:is_maximized", (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false;
  });
  ipcMain.handle("window:resize_start", (event, direction: string) => {
    startResize(event, direction);
  });
  ipcMain.handle("window:resize_end", () => {
    stopResize();
  });
}

let coversDir = "";

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);

  const userData = app.getPath("userData");
  coversDir = path.join(userData, "covers");
  mkdirSync(coversDir, { recursive: true });
  store = new LibraryStore(path.join(userData, "library.json"));
  playlists = new PlaylistStore(path.join(userData, "playlists.json"));
  spotifyLiked = new SpotifyLikedStore(
    path.join(userData, "spotify-liked.json"),
    store,
  );
  spotifyCatalog = new SpotifyCatalogService({ BrowserWindow, session }, store);
  stats = new StatsStore(path.join(userData, "stats.json"));
  trackDelays = new TrackDelayStore(path.join(userData, "track-delays.json"));
  releases = new ReleasesStore(
    path.join(userData, "followed-artists.json"),
    store,
    () => {
      const settings = resolveDownloaderSettings(store);
      if (!settings.scriptPath) return "";
      return path.join(
        path.dirname(settings.scriptPath),
        "downloaded_tracks.txt",
      );
    },
  );
  downloads = new DownloadManager({    store,
    coversDir,
    userDataDir: userData,
    getSettings: () => resolveDownloaderSettings(store),
    onProgress: (snapshot) => send("download:progress", snapshot),
    onComplete: async (payload) => {
      const feed = releases.refreshDownloadedStatus();
      const status = await spotifyStatusPayload();
      send("download:complete", {
        ...payload,
        feed: { ...feed, authenticated: status.authenticated },
      });
    },
  });
  perfMark("stores-ready");
  await backfillFileMetadata();
  perfMark("backfill-done");

  registerMediaProtocol(coversDir);
  registerIpc();
  perfMark("ipc-ready");
  initDiscordRpc(
    process.env.LYRICS_PLUS_DISCORD_CLIENT_ID ||
      store.getSetting("discord_client_id") ||
      "",
  );

  mainWindow = createWindow();
  perfMark("window-created");
  mainWindow.once("ready-to-show", () => {
    // Let the first frame and any immediate playback settle before cover work.
    setTimeout(() => void migrateCoverVariants(), 8000);
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  stopResize();
  store?.flushPendingSettings();
  downloads?.dispose();
  releases?.dispose();
  spotifyCatalog?.dispose();
  destroyDiscordRpc();
});
