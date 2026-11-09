export const LYRICS_MODES = ["karaoke", "synced", "unsynced"] as const;
export type LyricsMode = (typeof LYRICS_MODES)[number];

export type {
  ArtistSource,
  DownloadCompleteEvent,
  DownloadRequest,
  DownloadSnapshot,
  DownloadStage,
  DownloadTask,
  DownloadTaskStatus,
  FollowedArtist,
  MusicFolder,
  MusicFolderAddResult,
  MusicFolderRemoveResult,
  MusicFolderRescanResult,
  ReleaseFeed,
  ReleaseRecord,
  ReleaseTrack,
  ReleaseType,
} from "../electron/api";

/** Accept persisted/legacy mode ids regardless of case or surrounding spaces. */
export function normalizeLyricsMode(value: unknown): LyricsMode | null {
  const id = String(value ?? "").trim().toLowerCase();
  return (LYRICS_MODES as readonly string[]).includes(id)
    ? (id as LyricsMode)
    : null;
}

export type AppView =
  | "library"
  | "player"
  | "karaoke"
  | "playlist"
  | "artist"
  | "stats"
  | "releases";
export type LibrarySection = "tracks" | "albums" | "artists" | "playlists";

export type NavigationEntry =
  | { type: "library"; section?: LibrarySection; query?: string }
  | { type: "artists" }
  | { type: "artist-detail"; artistId: string }
  | { type: "playlist"; playlistId: string }
  | { type: "now-playing" }
  | { type: "karaoke" }
  | { type: "stats" }
  | { type: "releases" }
  | { type: "search"; query?: string };

export type RepeatMode = "off" | "all" | "one";

export interface Track {
  id: number;
  path: string;
  title: string;
  artist: string;
  album: string;
  albumArtist: string | null;
  spotifyTrackId?: string | null;
  genre: string | null;
  year: number | null;
  trackNo: number | null;
  durationMs: number;
  format: string;
  bitrate: number | null;
  sampleRate: number | null;
  bitDepth: number | null;
  channels: number | null;
  fileSize: number;
  /** Physical file name, used by AIMP-style sorting. */
  fileName: string;
  /** File mtime on disk (ms since epoch). */
  modifiedAt: number;
  coverPath: string | null;
  coverFullPath: string | null;
  hasEmbeddedLyrics: boolean;
  addedAt: number;
}

export interface TrackStatsRecord {
  playCount: number;
  /** Actual listening time in seconds. */
  totalListenTime: number;
  lastPlayedTimestamp: number;
}

export interface StatsData {
  version: 1;
  tracks: Record<string, TrackStatsRecord>;
}

export interface StatsTrackEntry extends TrackStatsRecord {
  track: Track;
}

export interface ArtistGroup {
  name: string;
  trackCount: number;
  albumCount: number;
  coverUrl?: string;
  /** Track used to render the avatar and to derive a palette fallback. */
  coverTrack: Track;
  tracks: Track[];
}

export interface AlbumGroup {
  key: string;
  album: string;
  artist: string;
  trackCount: number;
  coverUrl?: string;
  coverTrack: Track;
  tracks: Track[];
}

export interface Playlist {
  id: string;
  name: string;
  description?: string;
  trackPaths: string[];
  createdAt: number;
  updatedAt: number;
}

export interface LyricWord {
  time: number;
  text: string;
  /** Author-provided word length in ms. Missing values fall back to 400 ms. */
  duration?: number;
  /**
   * True for word timings distributed by the player from line timestamps.
   * Those span the whole line-to-line gap, so they cannot mark where vocals end.
   */
  estimated?: boolean;
}

export interface LyricLine {
  time: number;
  endTime: number;
  text: string;
  words: LyricWord[];
}

export interface LyricsPayload {
  trackId: number;
  source: string;
  synced: boolean;
  content: string;
  lineCount: number;
  instrumental: boolean;
}

export type LyricsStatus =
  | "idle"
  | "loading"
  | "ready"
  | "empty"
  | "instrumental"
  | "error";

export interface PlaybackSnapshot {
  path: string | null;
  positionMs: number;
  durationMs: number;
  paused: boolean;
  volume: number;
  eof: boolean;
}

export interface DiscordPresence {
  title: string;
  artist: string;
  album: string;
  artwork: string | null;
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;
}

export interface ScanProgress {
  current: number;
  total: number;
  file: string;
}

export interface ScanSummary {
  scanned: number;
  added: number;
  updated: number;
  errors: string[];
  durationMs: number;
}

export interface Palette {
  primary: string;
  secondary: string;
  glow: string;
  /** Cover art has no usable hue; use a neutral graphite/white treatment. */
  monochrome: boolean;
}
