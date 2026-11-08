import { create } from "zustand";
import type {
  AppView,
  LibrarySection,
  LyricsMode,
  LyricsStatus,
  LyricLine,
  MusicFolderAddResult,
  MusicFolderRemoveResult,
  MusicFolderRescanResult,
  NavigationEntry,
  PlaybackSnapshot,
  RepeatMode,
  ScanProgress,
  Track,
} from "@/types";
import { normalizeLyricsMode } from "@/types";
import { backend } from "@/lib/api";
import { ensureWordTimings, parseLrc, parsePlainLyrics } from "@/lib/lrc";
import { useSettingsStore } from "@/store/settingsStore";
import { useToastStore } from "@/store/toastStore";

let lyricsRequest = 0;
let lyricsDebounce: { timer: ReturnType<typeof setTimeout>; resolve: () => void } | null = null;
let initialized = false;

const LYRICS_DEBOUNCE_MS = 350;

/** Prevents the 100 ms clock from starting the same crossfade twice. */
let crossfadeArmedFor: string | null = null;

/** A play is credited after 25 seconds or when the track reaches its end. */
const PLAY_CREDIT_THRESHOLD_MS = 25_000;
/** Persist the tail of a long listening session without over-counting plays. */
const STATS_FLUSH_INTERVAL_MS = 30_000;

interface ListeningSession {
  path: string;
  listenedMs: number;
  recordedMs: number;
  lastPositionMs: number;
  counted: boolean;
}

let listeningSession: ListeningSession | null = null;

function recordSessionTime(session: ListeningSession): void {
  if (session.counted) {
    const remaining = session.listenedMs - session.recordedMs;
    if (remaining >= STATS_FLUSH_INTERVAL_MS) {
      session.recordedMs = session.listenedMs;
      void backend
        .addListenTime(session.path, remaining / 1000)
        .catch(() => undefined);
    }
    return;
  }

  if (session.listenedMs < PLAY_CREDIT_THRESHOLD_MS) return;
  session.counted = true;
  session.recordedMs = session.listenedMs;
  void backend
    .trackPlayed(session.path, session.listenedMs / 1000)
    .catch(() => undefined);
}

function beginListeningSession(trackPath: string, positionMs: number): void {
  listeningSession = {
    path: trackPath,
    listenedMs: 0,
    recordedMs: 0,
    lastPositionMs: Math.max(0, positionMs),
    counted: false,
  };
}

function finalizeListeningSession(ended: boolean): void {
  const session = listeningSession;
  if (!session) return;
  listeningSession = null;

  if (session.counted) {
    // Always flush the tail when the track is switched, even if the periodic
    // 30 second flush has not fired yet.
    const remaining = session.listenedMs - session.recordedMs;
    if (remaining >= 100) {
      void backend
        .addListenTime(session.path, remaining / 1000)
        .catch(() => undefined);
    }
    return;
  }

  if (ended || session.listenedMs >= PLAY_CREDIT_THRESHOLD_MS) {
    void backend
      .trackPlayed(session.path, session.listenedMs / 1000)
      .catch(() => undefined);
  }
}

/**
 * Turn the 100 ms playback clock into wall-clock listening time. Seek jumps and
 * paused snapshots are ignored, so stats only reflect time actually heard.
 */
function noteListeningSnapshot(
  snapshot: PlaybackSnapshot,
  trackPath: string,
): void {
  if (!listeningSession || listeningSession.path !== trackPath) {
    beginListeningSession(trackPath, snapshot.positionMs);
    return;
  }

  const session = listeningSession;
  const delta = snapshot.positionMs - session.lastPositionMs;
  session.lastPositionMs = Math.max(0, snapshot.positionMs);
  if (snapshot.paused || snapshot.eof) {
    // Pausing is not the end of the session, but the tail heard so far should
    // still survive an app quit while the player sits idle.
    if (session.counted) {
      const remaining = session.listenedMs - session.recordedMs;
      if (remaining >= 100) {
        session.recordedMs = session.listenedMs;
        void backend
          .addListenTime(session.path, remaining / 1000)
          .catch(() => undefined);
      }
    }
    return;
  }
  if (delta > 0 && delta <= 2_000) session.listenedMs += delta;

  if (!session.counted && session.listenedMs >= PLAY_CREDIT_THRESHOLD_MS) {
    recordSessionTime(session);
    return;
  }
  if (session.counted) {
    recordSessionTime(session);
  }
}

/**
 * Pick the highest-priority enabled display mode that the loaded lyrics can
 * actually support. Line-synced lyrics always get word timings (real or
 * estimated), so karaoke is available for every synced track.
 */
function pickAutoMode(lines: LyricLine[]): LyricsMode {
  const hasLineTimings = lines.some(
    (line) => Number.isFinite(line.time) && line.text.trim().length > 0,
  );
  if (!hasLineTimings) return "unsynced";

  const priority = useSettingsStore
    .getState()
    .syncModes.filter((mode) => mode.enabled)
    .map((mode) => normalizeLyricsMode(mode.id))
    .filter((mode): mode is LyricsMode => mode !== null);

  // Walk the user's list in order. Unsynced never wins while timings exist,
  // because karaoke can always estimate word timings from line timings.
  for (const mode of priority) {
    if (mode === "karaoke" || mode === "synced") return mode;
  }

  // All synced-capable modes disabled/no priority: keep the richer view.
  return "karaoke";
}

function cancelLyricsDebounce(): void {
  if (!lyricsDebounce) return;
  clearTimeout(lyricsDebounce.timer);
  lyricsDebounce.resolve();
  lyricsDebounce = null;
}

/**
 * Wait before hitting the providers. Fast track switching only fetches lyrics
 * for the track the user actually stops on.
 */
function waitForLyricsDebounce(): Promise<void> {
  cancelLyricsDebounce();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (lyricsDebounce?.timer === timer) lyricsDebounce = null;
      resolve();
    }, LYRICS_DEBOUNCE_MS);
    lyricsDebounce = { timer, resolve };
  });
}

interface PlayerState {
  initialized: boolean;
  tracks: Track[];
  currentTrack: Track | null;
  queueIndex: number;
  playbackQueue: Track[];

  view: AppView;
  librarySection: LibrarySection;
  selectedPlaylistId: string | null;
  selectedArtistName: string | null;
  history: NavigationEntry[];
  currentIndex: number;
  lyricsMode: LyricsMode;
  lyricsModeLocked: boolean;
  focusMode: boolean;
  queueOpen: boolean;
  search: string;

  isPlaying: boolean;
  positionMs: number;
  durationMs: number;
  volume: number;
  muted: boolean;
  repeat: RepeatMode;
  shuffle: boolean;

  lyrics: LyricLine[];
  lyricsRaw: string;
  lyricsSource: string | null;
  lyricsSynced: boolean;
  lyricsStatus: LyricsStatus;
  lyricsInstrumental: boolean;

  scanning: boolean;
  scanProgress: ScanProgress | null;

  init: () => Promise<void>;
  playTrack: (track: Track, startMs?: number, queue?: Track[]) => Promise<void>;
  togglePlay: () => Promise<void>;
  next: (auto?: boolean) => Promise<void>;
  prev: () => Promise<void>;
  seek: (positionMs: number) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  toggleRepeat: () => void;
  toggleShuffle: () => void;
  setShuffle: (shuffle: boolean) => void;
  addToQueue: (track: Track) => void;
  loadLyrics: (track: Track, force?: boolean) => Promise<void>;

  setView: (view: AppView) => void;
  setLibrarySection: (section: LibrarySection) => void;
  openPlaylist: (playlistId: string) => void;
  openArtist: (artistName: string) => void;
  navigate: (entry: NavigationEntry) => void;
  goBack: () => void;
  goForward: () => void;
  setLyricsMode: (mode: LyricsMode) => void;
  toggleFocus: () => void;
  toggleQueue: () => void;
  setSearch: (search: string) => void;

  scan: (paths: string[]) => Promise<void>;
  addMusicFolder: () => Promise<MusicFolderAddResult | null>;
  removeMusicFolder: (
    folderPath: string,
  ) => Promise<MusicFolderRemoveResult | null>;
  rescanMusicFolders: () => Promise<MusicFolderRescanResult | null>;
  refreshLibrary: () => Promise<void>;
  handlePosition: (snapshot: PlaybackSnapshot) => void;
  handleScanProgress: (progress: ScanProgress) => void;
  handleEnded: () => void;
}

function normalizeNavigationEntry(entry: NavigationEntry): NavigationEntry {
  if (entry.type === "library") {
    return {
      type: "library",
      section: entry.section ?? "tracks",
      ...(entry.query ? { query: entry.query } : {}),
    };
  }
  if (entry.type === "search") {
    return {
      type: "search",
      ...(entry.query ? { query: entry.query } : {}),
    };
  }
  return entry;
}

function sameNavigationEntry(a: NavigationEntry, b: NavigationEntry): boolean {
  return (
    JSON.stringify(normalizeNavigationEntry(a)) ===
    JSON.stringify(normalizeNavigationEntry(b))
  );
}

function navigationState(entry: NavigationEntry): Partial<PlayerState> {
  const reset = {
    focusMode: false,
    selectedPlaylistId: null,
    selectedArtistName: null,
    search: "",
  };

  switch (entry.type) {
    case "library":
      return {
        ...reset,
        view: "library",
        librarySection: entry.section ?? "tracks",
        search: entry.query ?? "",
      };
    case "artists":
      return {
        ...reset,
        view: "library",
        librarySection: "artists",
      };
    case "artist-detail":
      return {
        ...reset,
        view: "artist",
        librarySection: "artists",
        selectedArtistName: entry.artistId,
      };
    case "playlist":
      return {
        ...reset,
        view: "playlist",
        selectedPlaylistId: entry.playlistId,
      };
    case "karaoke":
      return {
        ...reset,
        view: "player",
      };
    case "stats":
      return {
        ...reset,
        view: "stats",
      };
    case "releases":
      return {
        ...reset,
        view: "releases",
      };
    case "search":
      return {
        ...reset,
        view: "library",
        librarySection: "tracks",
        search: entry.query ?? "",
      };
  }
}

/** Karaoke can be opened before a track was ever selected. */
function ensurePlayableTrack(
  getState: () => PlayerState,
  setState: (partial: Partial<PlayerState>) => void,
): void {
  const { currentTrack, tracks, loadLyrics } = getState();
  const first = currentTrack ?? tracks[0];
  if (!first) return;
  if (!currentTrack) {
    setState({ currentTrack: first, durationMs: first.durationMs });
    void loadLyrics(first);
  }
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  initialized: false,
  tracks: [],
  currentTrack: null,
  queueIndex: 0,
  playbackQueue: [],

  view: "library",
  librarySection: "tracks",
  selectedPlaylistId: null,
  selectedArtistName: null,
  history: [{ type: "library", section: "tracks" }],
  currentIndex: 0,
  lyricsMode: "karaoke",
  lyricsModeLocked: false,
  focusMode: false,
  queueOpen: false,
  search: "",

  isPlaying: false,
  positionMs: 0,
  durationMs: 0,
  volume: 0.8,
  muted: false,
  repeat: "off",
  shuffle: false,

  lyrics: [],
  lyricsRaw: "",
  lyricsSource: null,
  lyricsSynced: false,
  lyricsStatus: "idle",
  lyricsInstrumental: false,

  scanning: false,
  scanProgress: null,

  init: async () => {
    if (initialized) return;
    initialized = true;
    set({ initialized: true });

    try {
      const [tracks, snapshot] = await Promise.all([
        backend.getTracks(),
        backend.getPlaybackState(),
      ]);
      const restored = snapshot.path
        ? tracks.find((track) => track.path === snapshot.path)
        : undefined;
      const current = restored ?? tracks[0] ?? null;
      const queueIndex = current
        ? Math.max(0, tracks.findIndex((track) => track.id === current.id))
        : 0;

      const storedVolume = Number.parseFloat(
        window.localStorage.getItem("lyricsplus.volume") ?? "",
      );
      const volume = Number.isFinite(storedVolume)
        ? Math.min(1, Math.max(0, storedVolume))
        : snapshot.volume / 100;

      set({
        tracks,
        playbackQueue: tracks,
        currentTrack: current,
        queueIndex,
        durationMs: current?.durationMs ?? snapshot.durationMs,
        positionMs: restored ? snapshot.positionMs : 0,
        isPlaying: Boolean(restored) && !snapshot.paused,
        volume,
      });

      if (volume !== snapshot.volume / 100) {
        void backend.setVolume(volume * 100);
      }
      if (current) {
        void get().loadLyrics(current);
      }
    } catch (error) {
      useToastStore.getState().push({
        kind: "error",
        title: "Could not load library",
        description: String(error),
      });
    }
  },

  playTrack: async (track, startMs = 0, queue) => {
    const { tracks } = get();
    if (get().view !== "player") get().navigate({ type: "karaoke" });
    const playbackQueue = queue && queue.length > 0 ? queue : tracks;
    const index = playbackQueue.findIndex((item) => item.id === track.id);
    const start = Math.max(0, Math.min(startMs, track.durationMs || startMs));

    finalizeListeningSession(false);
    beginListeningSession(track.path, start);

    set({
      currentTrack: track,
      playbackQueue,
      queueIndex: index >= 0 ? index : 0,
      view: "player",
      durationMs: track.durationMs,
      positionMs: start,
      isPlaying: true,
      lyrics: [],
      lyricsRaw: "",
      lyricsSource: null,
      lyricsSynced: false,
      lyricsStatus: "loading",
      lyricsInstrumental: false,
      // New track → re-run the automatic mode chain until the user locks one.
      lyricsModeLocked: false,
    });

    try {
      const { crossfadeEnabled, crossfadeDuration } = useSettingsStore.getState();
      const crossfadeMs = crossfadeEnabled ? crossfadeDuration * 1000 : 0;
      crossfadeArmedFor = track.path;
      await backend.play(track, start, crossfadeMs);
    } catch (error) {
      set({ isPlaying: false });
      useToastStore.getState().push({
        kind: "error",
        title: "Playback failed",
        description: String(error),
      });
    }
    void get().loadLyrics(track);
  },

  togglePlay: async () => {
    const { currentTrack, tracks, positionMs, durationMs } = get();
    if (!currentTrack) {
      const first = tracks[0];
      if (first) await get().playTrack(first);
      return;
    }

    if (durationMs > 0 && positionMs >= durationMs - 120) {
      get().seek(0);
    }

    try {
      // The selected track may not have been handed to the audio engine yet
      // (for example right after startup or a library scan).
      const snapshot = await backend.getPlaybackState();
      if (!snapshot.path || snapshot.path !== currentTrack.path) {
        await get().playTrack(currentTrack, positionMs);
        return;
      }

      const paused = await backend.togglePause();
      set({ isPlaying: !paused });
    } catch (error) {
      useToastStore.getState().push({
        kind: "error",
        title: "Playback failed",
        description: String(error),
      });
    }
  },

  next: async (auto = false) => {
    const { tracks, playbackQueue, queueIndex, repeat, shuffle } = get();
    const queue = playbackQueue.length > 0 ? playbackQueue : tracks;
    if (queue.length === 0) return;

    if (auto && repeat === "one") {
      get().seek(0);
      await backend.resume();
      set({ isPlaying: true });
      return;
    }

    let index: number;
    if (shuffle && queue.length > 1) {
      do {
        index = Math.floor(Math.random() * queue.length);
      } while (index === queueIndex);
    } else {
      index = queueIndex + 1;
    }

    if (index >= queue.length) {
      if (repeat === "all" || !auto) {
        index = 0;
      } else {
        set({ isPlaying: false });
        await backend.pause();
        return;
      }
    }

    const track = queue[index];
    if (track) await get().playTrack(track, 0, queue);
  },

  prev: async () => {
    const { tracks, playbackQueue, queueIndex, repeat, positionMs } = get();
    const queue = playbackQueue.length > 0 ? playbackQueue : tracks;
    if (queue.length === 0) return;
    if (positionMs > 3_000) {
      get().seek(0);
      return;
    }
    let index = queueIndex - 1;
    if (index < 0) index = repeat === "all" ? queue.length - 1 : 0;
    const track = queue[index];
    if (track) await get().playTrack(track, 0, queue);
  },

  seek: (positionMs) => {
    const duration = get().durationMs;
    const target = Math.max(
      0,
      Math.min(Math.round(positionMs), duration > 0 ? duration : Math.round(positionMs)),
    );
    set({ positionMs: target, isPlaying: get().isPlaying });
    void backend.seek(target).catch(() => undefined);
  },

  setVolume: (volume) => {
    const clamped = Math.min(1, Math.max(0, volume));
    set({ volume: clamped, muted: clamped === 0 ? get().muted : false });
    window.localStorage.setItem("lyricsplus.volume", String(clamped));
    void backend.setVolume(clamped * 100).catch(() => undefined);
  },

  toggleMute: () => {
    const { muted, volume } = get();
    if (muted) {
      set({ muted: false });
      void backend.setVolume(volume * 100).catch(() => undefined);
    } else {
      set({ muted: true });
      void backend.setVolume(0).catch(() => undefined);
    }
  },

  toggleRepeat: () => {
    const order: RepeatMode[] = ["off", "all", "one"];
    const next = order[(order.indexOf(get().repeat) + 1) % order.length];
    set({ repeat: next });
  },

  toggleShuffle: () => set({ shuffle: !get().shuffle }),

  setShuffle: (shuffle) => set({ shuffle }),

  addToQueue: (track) => {
    const { playbackQueue, queueIndex, currentTrack, tracks } = get();
    if (!currentTrack) {
      set({ playbackQueue: [track], queueIndex: 0 });
      useToastStore.getState().push({
        kind: "success",
        title: "Added to queue",
        description: track.title,
      });
      return;
    }
    const queue = playbackQueue.length > 0 ? playbackQueue : tracks;
    const insertAt = Math.min(queue.length, queueIndex + 1);
    const next = [...queue];
    next.splice(insertAt, 0, track);
    set({ playbackQueue: next });
    useToastStore.getState().push({
      kind: "success",
      title: "Added to queue",
      description: track.title,
    });
  },

  loadLyrics: async (track, force = false) => {
    const request = ++lyricsRequest;
    // Clear immediately: old karaoke must never survive a track switch.
    set({
      lyricsStatus: "loading",
      lyrics: [],
      lyricsRaw: "",
      lyricsSource: null,
      lyricsSynced: false,
      lyricsInstrumental: false,
    });

    await waitForLyricsDebounce();
    if (request !== lyricsRequest) return;

    try {
      const payload = await backend.getLyrics(track.id, force);
      if (request !== lyricsRequest) return;

      if (payload.instrumental) {
        set({
          lyricsStatus: "instrumental",
          lyricsSource: payload.source,
          lyricsSynced: false,
          lyricsInstrumental: true,
        });
        return;
      }

      if (payload.synced) {
        const lines = ensureWordTimings(parseLrc(payload.content));
        if (lines.length === 0) {
          set({ lyricsStatus: "empty", lyricsSource: payload.source });
          return;
        }
        // Priority is user configurable in Lyrics & Display → Sync mode priority.
        const autoMode: LyricsMode = pickAutoMode(lines);
        const { lyricsMode, lyricsModeLocked } = get();
        set({
          lyrics: lines,
          lyricsRaw: payload.content,
          lyricsSource: payload.source,
          lyricsSynced: true,
          lyricsStatus: "ready",
          lyricsInstrumental: false,
          lyricsMode: lyricsModeLocked ? lyricsMode : autoMode,
        });
        return;
      }

      const lines = parsePlainLyrics(payload.content);
      set({
        lyrics: lines,
        lyricsRaw: payload.content,
        lyricsSource: payload.source,
        lyricsSynced: false,
        lyricsStatus: lines.length > 0 ? "ready" : "empty",
        lyricsInstrumental: false,
        lyricsMode: "unsynced",
      });
    } catch (error) {
      if (request !== lyricsRequest) return;
      set({
        lyricsStatus: "error",
        lyrics: [],
        lyricsRaw: "",
        lyricsSource: null,
        lyricsSynced: false,
      });
      if (force) {
        useToastStore.getState().push({
          kind: "error",
          title: "No lyrics found",
          description: String(error),
        });
      }
    }
  },

  setView: (view) => {
    const state = get();
    if (view === "library") {
      state.navigate(
        state.librarySection === "artists"
          ? { type: "artists" }
          : {
              type: "library",
              section: state.librarySection,
              query: state.search || undefined,
            },
      );
      return;
    }
    if (view === "playlist") {
      if (state.selectedPlaylistId) {
        state.navigate({ type: "playlist", playlistId: state.selectedPlaylistId });
      } else {
        state.navigate({ type: "library", section: "playlists" });
      }
      return;
    }
    if (view === "artist") {
      if (state.selectedArtistName) {
        state.navigate({ type: "artist-detail", artistId: state.selectedArtistName });
      } else {
        state.navigate({ type: "artists" });
      }
      return;
    }
    if (view === "stats") {
      state.navigate({ type: "stats" });
      return;
    }
    state.navigate({ type: "karaoke" });
  },

  setLibrarySection: (librarySection) => {
    if (librarySection === "artists") {
      get().navigate({ type: "artists" });
      return;
    }
    get().navigate({
      type: "library",
      section: librarySection,
      query: get().search || undefined,
    });
  },

  openPlaylist: (playlistId) =>
    get().navigate({ type: "playlist", playlistId }),

  openArtist: (artistId) =>
    get().navigate({ type: "artist-detail", artistId }),

  navigate: (entry) => {
    const nextEntry = normalizeNavigationEntry(entry);
    const { history, currentIndex } = get();
    const current = history[currentIndex];

    if (current && sameNavigationEntry(current, nextEntry)) {
      set(navigationState(nextEntry));
      if (nextEntry.type === "karaoke") ensurePlayableTrack(get, set);
      return;
    }

    const nextHistory = [...history.slice(0, currentIndex + 1), nextEntry];
    set({
      history: nextHistory,
      currentIndex: nextHistory.length - 1,
      ...navigationState(nextEntry),
    });
    if (nextEntry.type === "karaoke") ensurePlayableTrack(get, set);
  },

  goBack: () => {
    const { history, currentIndex } = get();
    if (currentIndex <= 0) return;
    const nextIndex = currentIndex - 1;
    const entry = history[nextIndex];
    if (!entry) return;
    set({ currentIndex: nextIndex, ...navigationState(entry) });
    if (entry.type === "karaoke") ensurePlayableTrack(get, set);
  },

  goForward: () => {
    const { history, currentIndex } = get();
    if (currentIndex >= history.length - 1) return;
    const nextIndex = currentIndex + 1;
    const entry = history[nextIndex];
    if (!entry) return;
    set({ currentIndex: nextIndex, ...navigationState(entry) });
    if (entry.type === "karaoke") ensurePlayableTrack(get, set);
  },

  setLyricsMode: (lyricsMode) => set({ lyricsMode, lyricsModeLocked: true }),

  toggleFocus: () => {
    const { focusMode, view } = get();
    if (!focusMode && view !== "player") {
      get().navigate({ type: "karaoke" });
    }
    set({ focusMode: !focusMode });
  },

  toggleQueue: () => set({ queueOpen: !get().queueOpen }),

  setSearch: (search) => {
    set((state) => {
      const current = state.history[state.currentIndex];
      if (current?.type !== "library" && current?.type !== "search") {
        return { search };
      }
      const history = [...state.history];
      history[state.currentIndex] = normalizeNavigationEntry({
        ...current,
        query: search,
      });
      return { search, history };
    });
  },

  addMusicFolder: async () => {
    set({
      scanning: true,
      scanProgress: { current: 0, total: 0, file: "Choose a music folder…" },
    });
    try {
      const result = await backend.addMusicFolder();
      if (result.cancelled) {
        set({ scanning: false, scanProgress: null });
        return result;
      }
      if (result.alreadyExists) {
        set({ scanning: false, scanProgress: null });
        useToastStore.getState().push({
          kind: "info",
          title: "Folder already in library",
          description: "This source is already being scanned.",
        });
        return result;
      }

      await get().refreshLibrary();
      set({ scanning: false, scanProgress: null });

      const summary = result.summary;
      useToastStore.getState().push({
        kind: "success",
        title: "Music folder added",
        description: summary
          ? `${summary.added} added · ${summary.updated} refreshed · ${summary.scanned.toLocaleString()} files`
          : "The source is ready.",
      });
      return result;
    } catch (error) {
      set({ scanning: false, scanProgress: null });
      useToastStore.getState().push({
        kind: "error",
        title: "Could not add music folder",
        description: String(error),
      });
      return null;
    }
  },

  removeMusicFolder: async (folderPath) => {
    try {
      const result = await backend.removeMusicFolder(folderPath);
      await get().refreshLibrary();
      useToastStore.getState().push({
        kind: "success",
        title: "✓ Folder removed and library updated",
        description: `${result.removedTracks.toLocaleString()} tracks removed · ${result.folders.length} ${result.folders.length === 1 ? "source" : "sources"} remaining`,
      });
      return result;
    } catch (error) {
      useToastStore.getState().push({
        kind: "error",
        title: "Could not remove folder",
        description: String(error),
      });
      return null;
    }
  },

  rescanMusicFolders: async () => {
    set({
      scanning: true,
      scanProgress: { current: 0, total: 0, file: "Preparing library…" },
    });
    try {
      const result = await backend.rescanMusicFolders();
      await get().refreshLibrary();
      set({ scanning: false, scanProgress: null });

      if (!result.summary) {
        useToastStore.getState().push({
          kind: "info",
          title: "No music folders",
          description: "Add a source folder before rescanning.",
        });
        return result;
      }

      const summary = result.summary;
      useToastStore.getState().push({
        kind: "success",
        title: "Library rescanned",
        description: `${summary.scanned.toLocaleString()} scanned · ${summary.added} added · ${(summary.durationMs / 1000).toFixed(1)}s${summary.errors.length > 0 ? ` · ${summary.errors.length} errors` : ""}`,
      });
      return result;
    } catch (error) {
      set({ scanning: false, scanProgress: null });
      useToastStore.getState().push({
        kind: "error",
        title: "Rescan failed",
        description: String(error),
      });
      return null;
    }
  },

  scan: async (paths) => {
    set({
      scanning: true,
      scanProgress: { current: 0, total: 0, file: "Preparing library…" },
    });
    try {
      const summary = await backend.scanLibrary(paths, (progress) =>
        set({ scanProgress: progress }),
      );
      const previous = get();
      const tracks = await backend.getTracks();
      const current = previous.currentTrack;
      const queueWasLibrary =
        previous.playbackQueue.length === previous.tracks.length &&
        previous.playbackQueue.every(
          (track, index) => track.id === previous.tracks[index]?.id,
        );
      const playbackQueue = queueWasLibrary ? tracks : previous.playbackQueue;
      const queueIndex = current
        ? Math.max(0, playbackQueue.findIndex((track) => track.id === current.id))
        : 0;

      set({
        tracks,
        playbackQueue,
        scanning: false,
        scanProgress: null,
        queueIndex,
      });

      if (!current && tracks[0]) {
        set({ currentTrack: tracks[0], durationMs: tracks[0].durationMs });
        void get().loadLyrics(tracks[0]);
      }

      useToastStore.getState().push({
        kind: "success",
        title: summary.scanned > 0 ? "Library updated" : "Nothing new found",
        description:
          summary.scanned > 0
            ? `${summary.added} added · ${summary.updated} refreshed · ${(summary.durationMs / 1000).toFixed(1)}s`
            : "Pick another folder or check file permissions.",
      });
    } catch (error) {
      set({ scanning: false, scanProgress: null });
      useToastStore.getState().push({
        kind: "error",
        title: "Scan failed",
        description: String(error),
      });
    }
  },

  refreshLibrary: async () => {
    try {
      const tracks = await backend.getTracks();
      const previous = get();
      const queueWasLibrary =
        previous.playbackQueue.length === previous.tracks.length &&
        previous.playbackQueue.every(
          (track, index) => track.id === previous.tracks[index]?.id,
        );
      const playbackQueue = queueWasLibrary ? tracks : previous.playbackQueue;
      const current = previous.currentTrack
        ? tracks.find((track) => track.id === previous.currentTrack?.id) ??
          previous.currentTrack
        : null;
      const queueIndex = current
        ? Math.max(0, playbackQueue.findIndex((track) => track.id === current.id))
        : 0;
      set({
        tracks,
        currentTrack: current,
        playbackQueue,
        queueIndex,
      });
    } catch (error) {
      console.error("[player] could not refresh library:", error);
    }
  },

  handlePosition: (snapshot) => {
    const current = get().currentTrack;
    if (!current) return;
    if (snapshot.path && snapshot.path !== current.path) return;
    set({
      positionMs: snapshot.positionMs,
      durationMs: snapshot.durationMs || current.durationMs,
      isPlaying: !snapshot.paused && !snapshot.eof,
    });
    noteListeningSnapshot(snapshot, current.path);

    // Start the next track a little before the end so both decks can overlap.
    // The audio engine ignores `ended` from the outgoing deck once the new one
    // becomes active.
    const { crossfadeEnabled, crossfadeDuration } = useSettingsStore.getState();
    if (
      !crossfadeEnabled ||
      crossfadeDuration <= 0 ||
      crossfadeArmedFor !== current.path ||
      snapshot.paused ||
      snapshot.eof ||
      snapshot.positionMs <= 500 ||
      snapshot.durationMs <= 0
    ) {
      return;
    }
    const remaining = snapshot.durationMs - snapshot.positionMs;
    if (remaining <= 0 || remaining > crossfadeDuration * 1000) return;

    const { playbackQueue, queueIndex, repeat, shuffle, tracks } = get();
    const queue = playbackQueue.length > 0 ? playbackQueue : tracks;
    if (queue.length < 2 || repeat === "one") return;
    const hasNext =
      shuffle || queueIndex < queue.length - 1 || repeat === "all";
    if (!hasNext) return;

    crossfadeArmedFor = null;
    // The outgoing deck never fires `ended` after a crossfade, but the listener
    // effectively reached the end of the track and deserves the play credit.
    finalizeListeningSession(true);
    void get().next(true);
  },

  handleScanProgress: (scanProgress) => {
    if (get().scanning) set({ scanProgress });
  },

  handleEnded: () => {
    finalizeListeningSession(true);
    void get().next(true);
  },
}));
