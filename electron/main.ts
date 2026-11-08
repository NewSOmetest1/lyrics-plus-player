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
import { defaultMusicDir, scanLibrary } from "./scanner";
import { StatsStore } from "./stats";
import { LibraryStore } from "./store";
import { TrackDelayStore } from "./trackDelays";
import {
  DownloadManager,
  resolveDownloaderSettings,
} from "./downloader";
import { ReleasesStore, resolvePreviewUrl } from "./releases";
import type {
  DownloadRequest,
  MusicFolder,
  MusicFolderAddResult,
  MusicFolderRemoveResult,
  MusicFolderRescanResult,
  ScanProgress,
} from "./types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

  window.once("ready-to-show", () => window.show());
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
  downloads = new DownloadManager({
    store,
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
  await backfillFileMetadata();

  registerMediaProtocol(coversDir);
  registerIpc();
  initDiscordRpc(
    process.env.LYRICS_PLUS_DISCORD_CLIENT_ID ||
      store.getSetting("discord_client_id") ||
      "",
  );

  mainWindow = createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  stopResize();
  downloads?.dispose();
  releases?.dispose();
  destroyDiscordRpc();
});
