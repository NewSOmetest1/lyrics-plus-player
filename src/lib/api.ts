import type {
  DiscordPresence,
  DownloadCompleteEvent,
  DownloadRequest,
  DownloadSnapshot,
  LyricsPayload,
  MusicFolder,
  MusicFolderAddResult,
  MusicFolderRemoveResult,
  MusicFolderRescanResult,
  PlaybackSnapshot,
  Playlist,
  ReleaseFeed,
  ScanProgress,
  ScanSummary,
  SpotifyArtistCacheEntry,
  SpotifyArtistCatalog,
  SpotifyArtistSummary,
  SpotifyAlbumCatalog,
  SpotifyCatalogTrack,
  SpotifyLikedSnapshot,
  SpotifyLikedTrackInput,
  SpotifyProfile,
  SpotifySearchCatalog,
  StatsData,
  Track,
  TrackFileDeleteResult,
  TrackStatsRecord,
} from "@/types";
import {
  LIKED_PLAYLIST_DESCRIPTION,
  LIKED_PLAYLIST_ID,
  LIKED_PLAYLIST_NAME,
} from "@/types";
import type { SpotifyAuthResult, SpotifyAuthStatus } from "../../electron/api";
import { DEMO_TRACKS, demoLyricsFor } from "@/data/demo";

export const isElectron =
  typeof window !== "undefined" && Boolean(window.electronAPI?.isElectron);

/** Desktop shell (Electron) vs. plain browser preview. */
export const isDesktop = isElectron;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Position clock for UI: 10 updates/s, not one per animation frame. */
const POSITION_INTERVAL_MS = 100;

const DEMO_PLAYLISTS_KEY = "lyricsplus.demoPlaylists";
const DEMO_STATS_KEY = "lyricsplus.demoStats";
const DEMO_TRACK_DELAYS_KEY = "lyricsplus.demoTrackDelays";

const EMPTY_DOWNLOAD_SNAPSHOT: DownloadSnapshot = {
  tasks: [],
  activeCount: 0,
  completedCount: 0,
};

const EMPTY_SPOTIFY_LIKED: SpotifyLikedSnapshot = {
  version: 1,
  items: [],
  total: 0,
  downloaded: 0,
  missing: 0,
  fetchedAt: null,
  source: null,
  warnings: [],
  authenticated: false,
};

function emptyReleaseFeed(): ReleaseFeed {
  return {
    version: 1,
    artists: [],
    releases: [],
    lastSyncedAt: null,
    lastSyncWarnings: [],
    authenticated: false,
  };
}

const TRACK_DELAY_LIMIT_MS = 10_000;

function normalizeTrackDelay(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(
    TRACK_DELAY_LIMIT_MS,
    Math.max(-TRACK_DELAY_LIMIT_MS, Math.round(parsed)),
  );
}

function readDemoTrackDelays(): Record<string, number> {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(DEMO_TRACK_DELAYS_KEY) ?? "{}",
    ) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const delays: Record<string, number> = {};
    for (const [trackPath, value] of Object.entries(parsed)) {
      const offset = normalizeTrackDelay(value);
      if (trackPath && offset) delays[trackPath] = offset;
    }
    return delays;
  } catch {
    return {};
  }
}

function writeDemoTrackDelays(delays: Record<string, number>): void {
  try {
    window.localStorage.setItem(DEMO_TRACK_DELAYS_KEY, JSON.stringify(delays));
  } catch {
    // Preview storage is best-effort.
  }
}

export interface PlaylistTrackChange {
  playlist: Playlist;
  changed: boolean;
}

function readDemoPlaylists(): Playlist[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(DEMO_PLAYLISTS_KEY) ?? "[]");
    return Array.isArray(parsed) ? (parsed as Playlist[]) : [];
  } catch {
    return [];
  }
}

function writeDemoPlaylists(playlists: Playlist[]): void {
  try {
    window.localStorage.setItem(DEMO_PLAYLISTS_KEY, JSON.stringify(playlists));
  } catch {
    // Preview storage is best-effort.
  }
}

function ensureDemoLikedPlaylist(): Playlist {
  const playlists = readDemoPlaylists();
  const existing = playlists.find(
    (playlist) => playlist.id === LIKED_PLAYLIST_ID,
  );
  if (existing) return existing;

  const named = playlists.find(
    (playlist) => playlist.name.trim().toLowerCase() === "liked songs",
  );
  if (named) {
    named.id = LIKED_PLAYLIST_ID;
    named.name = LIKED_PLAYLIST_NAME;
    if (!named.description?.trim()) {
      named.description = LIKED_PLAYLIST_DESCRIPTION;
    }
    named.updatedAt = Date.now();
    writeDemoPlaylists(playlists);
    return named;
  }

  const now = Date.now();
  const liked: Playlist = {
    id: LIKED_PLAYLIST_ID,
    name: LIKED_PLAYLIST_NAME,
    description: LIKED_PLAYLIST_DESCRIPTION,
    trackPaths: [],
    createdAt: now,
    updatedAt: now,
  };
  writeDemoPlaylists([liked, ...playlists]);
  return liked;
}

function readDemoPlaylistsWithLiked(): Playlist[] {
  const liked = ensureDemoLikedPlaylist();
  const playlists = readDemoPlaylists();
  return [liked, ...playlists.filter((playlist) => playlist.id !== liked.id)];
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths.filter((item) => typeof item === "string" && item.trim()))];
}

function roundSeconds(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value * 10) / 10;
}

function readDemoStats(): StatsData {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(DEMO_STATS_KEY) ?? "{}",
    ) as Partial<StatsData>;
    const tracks: Record<string, TrackStatsRecord> = {};
    if (parsed.tracks && typeof parsed.tracks === "object") {
      for (const [trackPath, value] of Object.entries(parsed.tracks)) {
        if (!value || typeof value !== "object") continue;
        const record = value as Partial<TrackStatsRecord>;
        tracks[trackPath] = {
          playCount: Math.max(0, Math.floor(Number(record.playCount) || 0)),
          totalListenTime: roundSeconds(Number(record.totalListenTime) || 0),
          lastPlayedTimestamp: Math.max(
            0,
            Number(record.lastPlayedTimestamp) || 0,
          ),
        };
      }
    }
    return { version: 1, tracks };
  } catch {
    return { version: 1, tracks: {} };
  }
}

function writeDemoStats(stats: StatsData): void {
  try {
    window.localStorage.setItem(DEMO_STATS_KEY, JSON.stringify(stats));
  } catch {
    // Preview storage is best-effort.
  }
}

function demoTrackPlayed(trackPath: string, durationSec: number): void {
  const data = readDemoStats();
  const existing = data.tracks[trackPath];
  data.tracks[trackPath] = {
    playCount: (existing?.playCount ?? 0) + 1,
    totalListenTime: roundSeconds(
      (existing?.totalListenTime ?? 0) + roundSeconds(durationSec),
    ),
    lastPlayedTimestamp: Date.now(),
  };
  writeDemoStats(data);
}

function demoAddListenTime(trackPath: string, durationSec: number): void {
  const data = readDemoStats();
  const existing = data.tracks[trackPath];
  if (!existing) return;
  existing.totalListenTime = roundSeconds(
    existing.totalListenTime + roundSeconds(durationSec),
  );
  writeDemoStats(data);
}

function demoPlaylistId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `demo-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function mediaAudioUrl(filePath: string): string {
  return `media://audio/?path=${encodeURIComponent(filePath)}`;
}

/**
 * Browser preview engine. Mirrors the playback event contract (100 ms position
 * updates + track-ended) so the UI can be developed without the desktop shell.
 */
class DemoEngine {
  private snapshot: PlaybackSnapshot = {
    path: null,
    positionMs: 0,
    durationMs: 0,
    paused: true,
    volume: 80,
    eof: false,
  };
  private positionListeners = new Set<(snapshot: PlaybackSnapshot) => void>();
  private endedListeners = new Set<() => void>();
  private timer: number | null = null;
  private lastTick = 0;

  play(path: string, startMs: number, durationMs: number) {
    this.snapshot = {
      ...this.snapshot,
      path,
      positionMs: Math.max(0, startMs),
      durationMs,
      paused: false,
      eof: false,
    };
    this.lastTick = performance.now();
    this.ensureTicker();
    this.emit();
  }

  pause() {
    this.snapshot.paused = true;
    this.emit();
  }

  resume() {
    if (this.snapshot.eof || this.snapshot.positionMs >= this.snapshot.durationMs) {
      this.snapshot.positionMs = 0;
      this.snapshot.eof = false;
    }
    this.snapshot.paused = false;
    this.lastTick = performance.now();
    this.emit();
  }

  togglePause(): boolean {
    if (this.snapshot.paused) this.resume();
    else this.pause();
    return this.snapshot.paused;
  }

  seek(positionMs: number) {
    this.snapshot.positionMs = Math.min(
      Math.max(0, positionMs),
      this.snapshot.durationMs || Number.MAX_SAFE_INTEGER,
    );
    this.snapshot.eof = false;
    this.lastTick = performance.now();
    this.emit();
  }

  setVolume(volume: number) {
    this.snapshot.volume = volume;
    this.emit();
  }

  stop() {
    this.snapshot = { ...this.snapshot, path: null, positionMs: 0, paused: true, eof: false };
    this.emit();
  }

  getSnapshot(): PlaybackSnapshot {
    return { ...this.snapshot };
  }

  onPosition(listener: (snapshot: PlaybackSnapshot) => void) {
    this.positionListeners.add(listener);
    return () => this.positionListeners.delete(listener);
  }

  onEnded(listener: () => void) {
    this.endedListeners.add(listener);
    return () => this.endedListeners.delete(listener);
  }

  private ensureTicker() {
    if (this.timer !== null) return;
    this.lastTick = performance.now();
    this.timer = window.setInterval(() => this.tick(), POSITION_INTERVAL_MS);
  }

  private tick() {
    const now = performance.now();
    const delta = now - this.lastTick;
    this.lastTick = now;
    if (!this.snapshot.path || this.snapshot.paused) return;

    this.snapshot.positionMs = Math.min(
      this.snapshot.durationMs,
      this.snapshot.positionMs + delta,
    );
    if (
      this.snapshot.durationMs > 0 &&
      this.snapshot.positionMs >= this.snapshot.durationMs - 1
    ) {
      this.snapshot.positionMs = this.snapshot.durationMs;
      this.snapshot.paused = true;
      this.snapshot.eof = true;
      this.emit();
      this.endedListeners.forEach((listener) => listener());
      return;
    }
    this.emit();
  }

  private emit() {
    const snapshot = { ...this.snapshot };
    this.positionListeners.forEach((listener) => listener(snapshot));
  }
}

/**
 * Real desktop playback through Chromium's media pipeline (PipeWire/PulseAudio
 * on Linux). FLAC, ALAC, MP3, OPUS, WAV and AAC are decoded natively.
 */
interface AudioDeck {
  audio: HTMLAudioElement;
  gain: GainNode | null;
  source: MediaElementAudioSourceNode | null;
}

/**
 * Real desktop playback through Chromium's media pipeline (PipeWire/PulseAudio
 * on Linux). Two HTMLAudioElements share one Web Audio graph, which lets a
 * finished track fade out while the next one ramps in.
 */
class AudioEngine {
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private graphFailed = false;
  private decks: AudioDeck[] = [];
  private activeDeck = 0;
  private crossfadeTimer: number | null = null;
  private snapshot: PlaybackSnapshot = {
    path: null,
    positionMs: 0,
    durationMs: 0,
    paused: true,
    volume: 80,
    eof: false,
  };
  private positionListeners = new Set<(snapshot: PlaybackSnapshot) => void>();
  private endedListeners = new Set<() => void>();

  constructor() {
    this.decks = [this.createDeck(0), this.createDeck(1)];
    window.setInterval(() => this.tick(), POSITION_INTERVAL_MS);
  }

  private createDeck(index: number): AudioDeck {
    const audio = new Audio();
    audio.preload = "auto";
    // Web Audio refuses to route media without CORS. The media:// handler
    // answers with Access-Control-Allow-Origin, so anonymous is safe.
    audio.crossOrigin = "anonymous";
    const deck: AudioDeck = { audio, gain: null, source: null };

    audio.addEventListener("loadedmetadata", () => {
      if (index !== this.activeDeck) return;
      if (Number.isFinite(audio.duration)) {
        this.snapshot.durationMs = Math.round(audio.duration * 1000);
      }
      this.emit();
    });
    audio.addEventListener("play", () => {
      if (index !== this.activeDeck) return;
      this.snapshot.paused = false;
      this.emit();
    });
    audio.addEventListener("pause", () => {
      if (index !== this.activeDeck || this.snapshot.eof) return;
      this.snapshot.paused = true;
      this.emit();
    });
    audio.addEventListener("ended", () => {
      if (index !== this.activeDeck) return;
      this.snapshot.paused = true;
      this.snapshot.eof = true;
      this.snapshot.positionMs = this.snapshot.durationMs;
      this.emit();
      this.endedListeners.forEach((listener) => listener());
    });
    audio.addEventListener("error", () => {
      if (index !== this.activeDeck || !import.meta.env.DEV) return;
      console.error(
        "[audio] media error",
        audio.error?.code,
        audio.error?.message,
        audio.src,
      );
    });

    return deck;
  }

  /**
   * Lazily build the Web Audio graph on the first play. createMediaElementSource
   * can only run once per element, and constructing the context from a user
   * gesture keeps Chromium's autoplay policy happy.
   */
  private ensureGraph(): boolean {
    if (this.graphFailed) return false;
    if (!this.context) {
      try {
        const context = new AudioContext();
        const master = context.createGain();
        master.gain.value = Math.min(1, Math.max(0, this.snapshot.volume / 100));
        master.connect(context.destination);
        for (const deck of this.decks) {
          const source = context.createMediaElementSource(deck.audio);
          const gain = context.createGain();
          gain.gain.value = 1;
          source.connect(gain);
          gain.connect(master);
          deck.source = source;
          deck.gain = gain;
          deck.audio.volume = 1;
        }
        this.context = context;
        this.masterGain = master;
      } catch (error) {
        this.graphFailed = true;
        if (import.meta.env.DEV) console.error("[audio] Web Audio unavailable", error);
        return false;
      }
    }
    if (this.context.state === "suspended") {
      void this.context.resume().catch(() => undefined);
    }
    return true;
  }

  private setDeckGain(deck: AudioDeck, value: number, at: number) {
    if (!deck.gain) return;
    deck.gain.gain.cancelScheduledValues(at);
    deck.gain.gain.setValueAtTime(value, at);
  }

  private stopDeck(deck: AudioDeck) {
    deck.audio.pause();
    deck.audio.removeAttribute("src");
    deck.audio.load();
    if (deck.gain) this.setDeckGain(deck, 1, this.context?.currentTime ?? 0);
  }

  play(path: string, startMs: number, durationMs: number, crossfadeMs = 0) {
    if (import.meta.env.DEV) {
      console.debug("[audio] play", path, startMs, crossfadeMs > 0 ? "crossfade" : "");
    }
    this.ensureGraph();
    if (this.crossfadeTimer !== null) {
      window.clearTimeout(this.crossfadeTimer);
      this.crossfadeTimer = null;
    }

    const current = this.decks[this.activeDeck];
    const canCrossfade =
      crossfadeMs > 0 &&
      Boolean(this.context) &&
      !this.snapshot.paused &&
      !this.snapshot.eof &&
      Boolean(current.audio.src) &&
      !current.audio.paused;

    const nextIndex = canCrossfade ? 1 - this.activeDeck : this.activeDeck;
    const next = this.decks[nextIndex];
    const oldIndex = this.activeDeck;

    if (!canCrossfade) {
      for (const deck of this.decks) {
        if (deck !== next) {
          deck.audio.pause();
          deck.audio.removeAttribute("src");
        }
      }
    }

    this.activeDeck = nextIndex;
    this.snapshot = {
      ...this.snapshot,
      path,
      positionMs: Math.max(0, startMs),
      durationMs,
      paused: false,
      eof: false,
    };

    const target = Math.max(0, startMs) / 1000;
    next.audio.src = mediaAudioUrl(path);
    if (next.gain && this.context) {
      const now = this.context.currentTime;
      const fadeSeconds = Math.min(6, Math.max(0, crossfadeMs / 1000));
      next.gain.gain.cancelScheduledValues(now);
      if (canCrossfade) {
        next.gain.gain.setValueAtTime(0.0001, now);
        next.gain.gain.linearRampToValueAtTime(1, now + fadeSeconds);
      } else {
        next.gain.gain.setValueAtTime(1, now);
      }
      if (canCrossfade) {
        const old = this.decks[oldIndex];
        if (old.gain) {
          const param = old.gain.gain;
          if (typeof param.cancelAndHoldAtTime === "function") {
            param.cancelAndHoldAtTime(now);
          } else {
            param.cancelScheduledValues(now);
          }
          param.linearRampToValueAtTime(0, now + fadeSeconds);
        }
        this.crossfadeTimer = window.setTimeout(() => {
          old.audio.pause();
          old.audio.removeAttribute("src");
          this.crossfadeTimer = null;
        }, fadeSeconds * 1000 + 60);
      }
    } else {
      next.audio.volume = Math.min(1, Math.max(0, this.snapshot.volume / 100));
    }

    if (target > 0) {
      const seekWhenReady = () => {
        try {
          next.audio.currentTime = target;
        } catch {
          // The browser may not accept a seek before metadata arrives.
        }
      };
      if (next.audio.readyState >= 1) seekWhenReady();
      else next.audio.addEventListener("loadedmetadata", seekWhenReady, { once: true });
    }
    void next.audio.play().catch((error) => {
      if (import.meta.env.DEV) console.error("[audio] play() rejected", error);
      this.snapshot.paused = true;
      this.emit();
    });
    this.emit();
  }

  pause() {
    if (this.crossfadeTimer !== null) {
      window.clearTimeout(this.crossfadeTimer);
      this.crossfadeTimer = null;
    }
    for (const [index, deck] of this.decks.entries()) {
      deck.audio.pause();
      if (index !== this.activeDeck && deck.audio.src) {
        deck.audio.removeAttribute("src");
        deck.audio.load();
      }
      if (deck.gain) this.setDeckGain(deck, 1, this.context?.currentTime ?? 0);
    }
    this.snapshot.paused = true;
    this.emit();
  }

  resume() {
    this.ensureGraph();
    const deck = this.decks[this.activeDeck];
    if (this.snapshot.eof || this.snapshot.positionMs >= this.snapshot.durationMs) {
      deck.audio.currentTime = 0;
      this.snapshot.positionMs = 0;
      this.snapshot.eof = false;
    }
    if (deck.gain && this.context) {
      this.setDeckGain(deck, 1, this.context.currentTime);
    }
    void deck.audio.play().catch(() => undefined);
    this.snapshot.paused = false;
    this.emit();
  }

  togglePause(): boolean {
    if (this.snapshot.paused) this.resume();
    else this.pause();
    return this.snapshot.paused;
  }

  seek(positionMs: number) {
    const target = Math.min(
      Math.max(0, positionMs),
      this.snapshot.durationMs || Number.MAX_SAFE_INTEGER,
    );
    try {
      this.decks[this.activeDeck].audio.currentTime = target / 1000;
    } catch {
      // ignore seeks before metadata
    }
    this.snapshot.positionMs = Math.round(target);
    this.snapshot.eof = false;
    this.emit();
  }

  setVolume(volume: number) {
    const clamped = Math.min(100, Math.max(0, volume));
    this.snapshot.volume = clamped;
    const level = clamped / 100;
    if (this.masterGain && this.context) {
      this.masterGain.gain.setValueAtTime(level, this.context.currentTime);
    } else {
      for (const deck of this.decks) deck.audio.volume = level;
    }
    this.emit();
  }

  stop() {
    if (this.crossfadeTimer !== null) {
      window.clearTimeout(this.crossfadeTimer);
      this.crossfadeTimer = null;
    }
    for (const deck of this.decks) this.stopDeck(deck);
    this.snapshot = { ...this.snapshot, path: null, positionMs: 0, paused: true, eof: false };
    this.emit();
  }

  getSnapshot(): PlaybackSnapshot {
    return { ...this.snapshot };
  }

  onPosition(listener: (snapshot: PlaybackSnapshot) => void) {
    this.positionListeners.add(listener);
    return () => this.positionListeners.delete(listener);
  }

  onEnded(listener: () => void) {
    this.endedListeners.add(listener);
    return () => this.endedListeners.delete(listener);
  }

  private tick() {
    const deck = this.decks[this.activeDeck];
    if (!this.snapshot.path || deck.audio.paused) return;
    if (Number.isFinite(deck.audio.currentTime)) {
      this.snapshot.positionMs = Math.round(deck.audio.currentTime * 1000);
    }
    if (Number.isFinite(deck.audio.duration)) {
      this.snapshot.durationMs = Math.round(deck.audio.duration * 1000);
    }
    this.emit();
  }

  private emit() {
    const snapshot = { ...this.snapshot };
    this.positionListeners.forEach((listener) => listener(snapshot));
  }
}

const demo = new DemoEngine();
const audio = new AudioEngine();

function electronApi() {
  if (!isElectron || !window.electronAPI) {
    throw new Error("Electron bridge is not available");
  }
  return window.electronAPI;
}

export interface PlaybackHandlers {
  onPosition: (snapshot: PlaybackSnapshot) => void;
  onEnded: () => void;
  onScanProgress?: (progress: ScanProgress) => void;
}

export interface ProviderTestResult {
  provider: "lrclib" | "spotify" | "musixmatch";
  ok: boolean;
  status: number | null;
  statusText: string;
  lines: number;
  synced: boolean;
  syncType?: string;
  sample: string[];
  message: string;
}

export const backend = {
  async getTracks(): Promise<Track[]> {
    if (!isElectron) return DEMO_TRACKS;
    return electronApi().invoke<Track[]>("get_tracks");
  },

  async scanLibrary(
    paths: string[],
    onProgress?: (progress: ScanProgress) => void,
  ): Promise<ScanSummary> {
    if (!isElectron) {
      const total = 24;
      for (let current = 1; current <= total; current += 1) {
        await sleep(35);
        onProgress?.({
          current,
          total,
          file: `~/Music/demo/cover-${String(current).padStart(2, "0")}.flac`,
        });
      }
      return {
        scanned: DEMO_TRACKS.length,
        added: 0,
        updated: DEMO_TRACKS.length,
        errors: [],
        durationMs: 840,
      };
    }
    const off = onProgress
      ? electronApi().on<ScanProgress>("scan-progress", onProgress)
      : () => undefined;
    try {
      return await electronApi().invoke<ScanSummary>("scan_library", paths);
    } finally {
      off();
    }
  },

  async getLyrics(trackId: number, force = false): Promise<LyricsPayload> {
    if (!isElectron) {
      await sleep(420);
      if (trackId === 4) {
        return {
          trackId,
          source: "lrclib",
          synced: false,
          content: "",
          lineCount: 0,
          instrumental: true,
        };
      }
      const content = demoLyricsFor(trackId);
      if (!content) throw new Error("No lyrics found");
      const synced = trackId !== 3;
      return {
        trackId,
        source: trackId === 1 ? "lrclib" : trackId === 2 ? "embedded" : "musixmatch",
        synced,
        content,
        lineCount: content.split("\n").filter(Boolean).length,
        instrumental: false,
      };
    }
    return electronApi().invoke<LyricsPayload>("get_lyrics", { trackId, force });
  },

  async testProvider(
    provider: ProviderTestResult["provider"],
    credentials?: { spDc?: string; spKey?: string },
  ): Promise<ProviderTestResult> {
    if (!isElectron) {
      await sleep(500);
      return {
        provider,
        ok: provider !== "spotify",
        status: 200,
        statusText: "200 OK",
        lines: provider === "lrclib" ? 58 : 0,
        synced: provider === "lrclib",
        syncType: provider === "spotify" ? "LINE_SYNCED" : undefined,
        sample: ["I've been tryin' to call", "I've been on my own for long enough"],
        message: provider === "spotify" ? "Browser preview has no sp_dc cookie" : "Demo result",
      };
    }
    return electronApi().invoke<ProviderTestResult>("test_provider", {
      provider,
      ...credentials,
    });
  },

  async play(track: Track, startMs = 0, crossfadeMs = 0): Promise<void> {
    if (!isElectron) {
      demo.play(track.path, startMs, track.durationMs);
      return;
    }
    audio.play(track.path, startMs, track.durationMs, crossfadeMs);
  },

  async pause(): Promise<void> {
    if (!isElectron) return demo.pause();
    audio.pause();
  },

  async resume(): Promise<void> {
    if (!isElectron) return demo.resume();
    audio.resume();
  },

  async togglePause(): Promise<boolean> {
    if (!isElectron) return demo.togglePause();
    return audio.togglePause();
  },

  async seek(positionMs: number): Promise<void> {
    if (!isElectron) return demo.seek(positionMs);
    audio.seek(positionMs);
  },

  async setVolume(volume: number): Promise<void> {
    if (!isElectron) return demo.setVolume(volume);
    audio.setVolume(volume);
  },

  async stop(): Promise<void> {
    if (!isElectron) return demo.stop();
    audio.stop();
  },

  async getPlaybackState(): Promise<PlaybackSnapshot> {
    if (!isElectron) return demo.getSnapshot();
    return audio.getSnapshot();
  },

  async getDefaultMusicDir(): Promise<string | null> {
    if (!isElectron) return "~/Music";
    return electronApi().invoke<string | null>("get_default_music_dir");
  },

  async pickFolder(): Promise<string | null> {
    if (!isElectron) return null;
    return electronApi().selectFolder();
  },

  async getMusicFolders(): Promise<MusicFolder[]> {
    if (!isElectron) {
      return [{ path: "~/Music/demo", trackCount: DEMO_TRACKS.length }];
    }
    return electronApi().invoke<MusicFolder[]>("folders:get");
  },

  async addMusicFolder(): Promise<MusicFolderAddResult> {
    if (!isElectron) {
      return {
        cancelled: true,
        alreadyExists: false,
        folders: [{ path: "~/Music/demo", trackCount: DEMO_TRACKS.length }],
        summary: null,
      };
    }
    return electronApi().invoke<MusicFolderAddResult>("folders:add");
  },

  async removeMusicFolder(folderPath: string): Promise<MusicFolderRemoveResult> {
    if (!isElectron) {
      return {
        folders: [{ path: "~/Music/demo", trackCount: DEMO_TRACKS.length }],
        removedTracks: 0,
      };
    }
    return electronApi().invoke<MusicFolderRemoveResult>(
      "folders:remove",
      folderPath,
    );
  },

  async rescanMusicFolders(): Promise<MusicFolderRescanResult> {
    if (!isElectron) {
      return {
        folders: [{ path: "~/Music/demo", trackCount: DEMO_TRACKS.length }],
        summary: {
          scanned: DEMO_TRACKS.length,
          added: 0,
          updated: DEMO_TRACKS.length,
          errors: [],
          durationMs: 840,
        },
      };
    }
    return electronApi().invoke<MusicFolderRescanResult>("folders:rescan");
  },

  async getPlaylists(): Promise<Playlist[]> {
    if (!isElectron) return readDemoPlaylistsWithLiked();
    return electronApi().invoke<Playlist[]>("playlists:getAll");
  },

  async ensureLikedPlaylist(): Promise<Playlist> {
    if (!isElectron) return ensureDemoLikedPlaylist();
    return electronApi().invoke<Playlist>("playlists:ensureLiked");
  },

  async createPlaylist(input: {
    name: string;
    description?: string;
    trackPaths?: string[];
  }): Promise<Playlist> {
    if (!isElectron) {
      const now = Date.now();
      const playlist: Playlist = {
        id: demoPlaylistId(),
        name: input.name.trim() || "Untitled playlist",
        description: input.description?.trim() || undefined,
        trackPaths: uniquePaths(input.trackPaths ?? []),
        createdAt: now,
        updatedAt: now,
      };
      writeDemoPlaylists([playlist, ...readDemoPlaylists()]);
      return playlist;
    }
    return electronApi().invoke<Playlist>("playlists:create", input);
  },

  async updatePlaylist(
    id: string,
    patch: { name?: string; description?: string; trackPaths?: string[] },
  ): Promise<Playlist> {
    if (!isElectron) {
      const playlists = readDemoPlaylists();
      const playlist = playlists.find((item) => item.id === id);
      if (!playlist) throw new Error("Playlist not found");
      if (patch.name !== undefined) {
        const name = patch.name.trim();
        if (!name) throw new Error("Playlist name cannot be empty");
        playlist.name = name;
      }
      if (patch.description !== undefined) {
        playlist.description = patch.description.trim() || undefined;
      }
      if (patch.trackPaths !== undefined) {
        playlist.trackPaths = uniquePaths(patch.trackPaths);
      }
      playlist.updatedAt = Date.now();
      writeDemoPlaylists(playlists);
      return playlist;
    }
    return electronApi().invoke<Playlist>("playlists:update", { id, ...patch });
  },

  async deletePlaylist(id: string): Promise<boolean> {
    if (!isElectron) {
      const playlists = readDemoPlaylists();
      const next = playlists.filter((item) => item.id !== id);
      writeDemoPlaylists(next);
      return next.length !== playlists.length;
    }
    return electronApi().invoke<boolean>("playlists:delete", id);
  },

  async addTrackToPlaylist(
    playlistId: string,
    trackPath: string,
  ): Promise<PlaylistTrackChange> {
    if (!isElectron) {
      const playlists = readDemoPlaylists();
      const playlist = playlists.find((item) => item.id === playlistId);
      if (!playlist) throw new Error("Playlist not found");
      const added = !playlist.trackPaths.includes(trackPath);
      if (added) {
        playlist.trackPaths.push(trackPath);
        playlist.updatedAt = Date.now();
        writeDemoPlaylists(playlists);
      }
      return { playlist, changed: added };
    }
    const result = await electronApi().invoke<{
      playlist: Playlist;
      added: boolean;
    }>("playlists:addTrack", { playlistId, trackPath });
    return { playlist: result.playlist, changed: result.added };
  },

  async removeTrackFromPlaylist(
    playlistId: string,
    trackPath: string,
  ): Promise<PlaylistTrackChange> {
    if (!isElectron) {
      const playlists = readDemoPlaylists();
      const playlist = playlists.find((item) => item.id === playlistId);
      if (!playlist) throw new Error("Playlist not found");
      const next = playlist.trackPaths.filter((item) => item !== trackPath);
      const removed = next.length !== playlist.trackPaths.length;
      if (removed) {
        playlist.trackPaths = next;
        playlist.updatedAt = Date.now();
        writeDemoPlaylists(playlists);
      }
      return { playlist, changed: removed };
    }
    const result = await electronApi().invoke<{
      playlist: Playlist;
      removed: boolean;
    }>("playlists:removeTrack", { playlistId, trackPath });
    return { playlist: result.playlist, changed: result.removed };
  },

  /**
   * Instant Liked Songs membership. The main process updates memory first and
   * coalesces the playlists.json write, so heart clicks never wait for disk.
   */
  async setLikedPlaylistTrack(
    trackPath: string,
    liked: boolean,
  ): Promise<PlaylistTrackChange> {
    if (!isElectron) {
      const playlists = readDemoPlaylists();
      const playlist = playlists.find((item) => item.id === LIKED_PLAYLIST_ID);
      if (!playlist) throw new Error("Liked Songs not found");
      const exists = playlist.trackPaths.includes(trackPath);
      if (exists !== liked) {
        playlist.trackPaths = liked
          ? [trackPath, ...playlist.trackPaths.filter((item) => item !== trackPath)]
          : playlist.trackPaths.filter((item) => item !== trackPath);
        playlist.updatedAt = Date.now();
        writeDemoPlaylists(playlists);
      }
      return { playlist, changed: exists !== liked };
    }
    const result = await electronApi().invoke<{
      playlist: Playlist;
      changed: boolean;
    }>("playlists:setLiked", { trackPath, liked });
    return { playlist: result.playlist, changed: result.changed };
  },

  async importM3U(): Promise<Playlist | null> {
    if (!isElectron) {
      throw new Error("M3U import is available in the desktop app");
    }
    return electronApi().invoke<Playlist | null>("playlists:importM3U");
  },

  async exportM3U(playlistId: string): Promise<string | null> {
    if (!isElectron) {
      const playlist = readDemoPlaylists().find((item) => item.id === playlistId);
      if (!playlist) throw new Error("Playlist not found");
      const content = [
        "#EXTM3U",
        `#PLAYLIST:${playlist.name}`,
        ...playlist.trackPaths,
      ].join("\n");
      const url = URL.createObjectURL(
        new Blob([`${content}\n`], { type: "audio/x-mpegurl" }),
      );
      const link = document.createElement("a");
      const fileName = `${playlist.name.replace(/[\\/:*?"<>|]/g, "-") || "playlist"}.m3u`;
      link.href = url;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(url);
      return fileName;
    }
    return electronApi().invoke<string | null>("playlists:exportM3U", playlistId);
  },

  async getSetting(key: string): Promise<string | null> {
    if (!isElectron) return null;
    return electronApi().invoke<string | null>("get_setting", key);
  },

  async setSetting(key: string, value: string): Promise<void> {
    if (!isElectron) return;
    await electronApi().invoke<void>("set_setting", { key, value });
  },

  async getTrackDelays(): Promise<Record<string, number>> {
    if (!isElectron) return readDemoTrackDelays();
    return electronApi().invoke<Record<string, number>>("track_delays:getAll");
  },

  async setTrackDelay(trackPath: string, offsetMs: number): Promise<number> {
    if (!isElectron) {
      const delays = readDemoTrackDelays();
      const value = normalizeTrackDelay(offsetMs) ?? 0;
      if (value === 0) delete delays[trackPath];
      else delays[trackPath] = value;
      writeDemoTrackDelays(delays);
      return value;
    }
    return electronApi().invoke<number>("track_delays:set", {
      trackPath,
      offsetMs,
    });
  },

  async resetTrackDelay(trackPath: string): Promise<void> {
    if (!isElectron) {
      const delays = readDemoTrackDelays();
      delete delays[trackPath];
      writeDemoTrackDelays(delays);
      return;
    }
    await electronApi().invoke<void>("track_delays:reset", trackPath);
  },

  async resetAllTrackDelays(): Promise<void> {
    if (!isElectron) {
      writeDemoTrackDelays({});
      return;
    }
    await electronApi().invoke<void>("track_delays:resetAll");
  },

  async getStats(): Promise<StatsData> {
    if (!isElectron) return readDemoStats();
    return electronApi().invoke<StatsData>("stats:get");
  },

  /** Credit one play (>25 s or reached the end) and its actual listen time. */
  async trackPlayed(trackPath: string, durationSec: number): Promise<void> {
    if (!isElectron) {
      demoTrackPlayed(trackPath, durationSec);
      return;
    }
    await electronApi().invoke<void>("stats:trackPlayed", {
      trackPath,
      durationSec,
    });
  },

  /** Add the rest of a long session without incrementing the play count. */
  async addListenTime(trackPath: string, durationSec: number): Promise<void> {
    if (!isElectron) {
      demoAddListenTime(trackPath, durationSec);
      return;
    }
    await electronApi().invoke<void>("stats:addListenTime", {
      trackPath,
      durationSec,
    });
  },

  async spotifyLogin(): Promise<SpotifyAuthResult> {
    if (!isElectron) {
      return {
        ok: false,
        message: "Spotify login needs the Electron desktop app.",
      };
    }
    return electronApi().invoke<SpotifyAuthResult>("spotify:login");
  },

  async spotifyLogout(): Promise<{ ok: boolean; message?: string }> {
    if (!isElectron) return { ok: false, message: "Desktop app only." };
    return electronApi().invoke<{ ok: boolean; message?: string }>(
      "spotify:logout",
    );
  },

  async spotifyStatus(): Promise<SpotifyAuthStatus> {
    if (!isElectron) {
      return { authenticated: false, hasSpDc: false, hasSpKey: false };
    }
    return electronApi().invoke<SpotifyAuthStatus>("spotify:status");
  },

  async spotifyProfile(): Promise<SpotifyProfile> {
    if (!isElectron) {
      return {
        ok: false,
        id: null,
        displayName: null,
        product: null,
        source: null,
        status: null,
        error: "Spotify profile needs the Electron desktop app.",
        notice: null,
      };
    }
    return electronApi().invoke<SpotifyProfile>("spotify:profile");
  },

  async getReleaseFeed(): Promise<ReleaseFeed> {
    if (!isElectron) return emptyReleaseFeed();
    return electronApi().invoke<ReleaseFeed>("releases:get");
  },

  async syncReleases(): Promise<ReleaseFeed> {
    if (!isElectron) {
      throw new Error("New Releases sync needs the Electron desktop app.");
    }
    return electronApi().invoke<ReleaseFeed>("releases:sync");
  },

  async setArtistFollow(
    name: string,
    following: boolean,
  ): Promise<ReleaseFeed> {
    if (!isElectron) {
      throw new Error("Artist following needs the Electron desktop app.");
    }
    return electronApi().invoke<ReleaseFeed>("releases:setFollow", {
      name,
      following,
    });
  },

  async getReleasePreview(trackId: string): Promise<string | null> {
    if (!isElectron) return null;
    return electronApi().invoke<string | null>("releases:preview", trackId);
  },

  async getDownloads(): Promise<DownloadSnapshot> {
    if (!isElectron) return EMPTY_DOWNLOAD_SNAPSHOT;
    return electronApi().invoke<DownloadSnapshot>("downloads:get");
  },

  async getSpotifyLiked(): Promise<SpotifyLikedSnapshot> {
    if (!isElectron) return EMPTY_SPOTIFY_LIKED;
    return electronApi().invoke<SpotifyLikedSnapshot>("spotify-liked:get");
  },

  async syncSpotifyLiked(): Promise<SpotifyLikedSnapshot> {
    if (!isElectron) {
      throw new Error("Spotify liked songs need the Electron desktop app.");
    }
    return electronApi().invoke<SpotifyLikedSnapshot>("spotify-liked:sync");
  },

  async setSpotifyLiked(
    trackId: string,
    liked: boolean,
    track?: SpotifyLikedTrackInput | null,
  ): Promise<SpotifyLikedSnapshot> {
    if (!isElectron) {
      throw new Error("Spotify liked songs need the Electron desktop app.");
    }
    return electronApi().invoke<SpotifyLikedSnapshot>("spotify-liked:set", {
      trackId,
      liked,
      track: track ?? null,
    });
  },

  async searchSpotify(query: string): Promise<SpotifySearchCatalog> {
    if (!isElectron) {
      return {
        query,
        artists: [],
        albums: [],
        tracks: [],
        warnings: ["Spotify catalog search needs the desktop app."],
      };
    }
    return electronApi().invoke<SpotifySearchCatalog>("spotify:search", query);
  },

  async getSpotifyArtistCache(): Promise<SpotifyArtistCacheEntry[]> {
    if (!isElectron) return [];
    return electronApi().invoke<SpotifyArtistCacheEntry[]>(
      "spotify:artist-cache",
    );
  },

  async getSpotifyArtist(
    artistId: string,
    name?: string,
  ): Promise<SpotifyArtistCatalog> {
    if (!isElectron) {
      throw new Error("Spotify artist pages need the Electron desktop app.");
    }
    return electronApi().invoke<SpotifyArtistCatalog>("spotify:artist", {
      artistId,
      name,
    });
  },

  async getSpotifyAlbumTracks(
    albumId: string,
    fallback?: { artist?: string; album?: string; coverUrl?: string | null },
  ): Promise<SpotifyCatalogTrack[]> {
    if (!isElectron) {
      throw new Error("Spotify albums need the Electron desktop app.");
    }
    return electronApi().invoke<SpotifyCatalogTrack[]>(
      "spotify:albumTracks",
      { albumId, ...fallback },
    );
  },

  async getSpotifyAlbum(
    albumId: string,
    fallback?: {
      artist?: string;
      album?: string;
      coverUrl?: string | null;
      releaseDate?: string;
      totalTracks?: number;
    },
  ): Promise<SpotifyAlbumCatalog> {
    if (!isElectron) {
      throw new Error("Spotify albums need the Electron desktop app.");
    }
    return electronApi().invoke<SpotifyAlbumCatalog>("spotify:album", {
      albumId,
      ...fallback,
    });
  },

  async resolveSpotifyArtist(
    name: string,
  ): Promise<SpotifyArtistSummary | null> {
    if (!isElectron) return null;
    return electronApi().invoke<SpotifyArtistSummary | null>(
      "spotify:resolveArtist",
      name,
    );
  },

  async startDownloads(
    tracks: DownloadRequest[],
  ): Promise<DownloadSnapshot> {
    if (!isElectron) return EMPTY_DOWNLOAD_SNAPSHOT;
    return electronApi().invoke<DownloadSnapshot>("downloads:start", tracks);
  },

  async cancelDownload(taskId: string): Promise<DownloadSnapshot> {
    if (!isElectron) return EMPTY_DOWNLOAD_SNAPSHOT;
    return electronApi().invoke<DownloadSnapshot>("downloads:cancel", taskId);
  },

  async clearCompletedDownloads(): Promise<DownloadSnapshot> {
    if (!isElectron) return EMPTY_DOWNLOAD_SNAPSHOT;
    return electronApi().invoke<DownloadSnapshot>("downloads:clearCompleted");
  },

  onDownloadProgress(
    listener: (snapshot: DownloadSnapshot) => void,
  ): () => void {
    if (!isElectron) return () => undefined;
    return electronApi().on<DownloadSnapshot>("download:progress", listener);
  },

  onDownloadComplete(
    listener: (payload: DownloadCompleteEvent) => void,
  ): () => void {
    if (!isElectron) return () => undefined;
    return electronApi().on<DownloadCompleteEvent>(
      "download:complete",
      listener,
    );
  },

  async updateDiscordPresence(presence: DiscordPresence | null): Promise<void> {
    if (!isElectron) return;
    await electronApi().invoke<void>("discord:update", presence);
  },

  async removeTrack(trackId: number): Promise<void> {
    if (!isElectron) return;
    await electronApi().invoke<void>("remove_track", trackId);
  },

  async deleteTrackFile(trackId: number): Promise<TrackFileDeleteResult> {
    if (!isElectron) {
      throw new Error("Deleting files is only available in the desktop app.");
    }
    return electronApi().invoke<TrackFileDeleteResult>(
      "delete_track_file",
      trackId,
    );
  },

  async clearLyricsCache(trackId: number): Promise<void> {
    if (!isElectron) return;
    await electronApi().invoke<void>("clear_lyrics_cache", trackId);
  },
};

export async function subscribePlayback(
  handlers: PlaybackHandlers,
): Promise<() => void> {
  if (!isElectron) {
    const unlistenPosition = demo.onPosition(handlers.onPosition);
    const unlistenEnded = demo.onEnded(handlers.onEnded);
    return () => {
      unlistenPosition();
      unlistenEnded();
    };
  }

  const unlistenPosition = audio.onPosition(handlers.onPosition);
  const unlistenEnded = audio.onEnded(handlers.onEnded);
  const unlistenScan = handlers.onScanProgress
    ? electronApi().on<ScanProgress>("scan-progress", handlers.onScanProgress)
    : () => undefined;
  return () => {
    unlistenPosition();
    unlistenEnded();
    unlistenScan();
  };
}

export function coverUrl(track: Track | null, full = false): string | null {
  if (!track) return null;
  const path = full ? track.coverFullPath ?? track.coverPath : track.coverPath;
  if (!path) return null;
  if (
    path.startsWith("data:") ||
    path.startsWith("http") ||
    path.startsWith("blob:") ||
    path.startsWith("media:")
  ) {
    return path;
  }
  return path;
}

/**
 * Artwork used for palette extraction. Migrated tracks keep a reference to
 * their pre-migration original so accent colors do not shift.
 */
export function coverPaletteUrl(track: Track | null): string | null {
  if (!track) return null;
  return track.coverPalettePath ?? track.coverFullPath ?? track.coverPath ?? null;
}
