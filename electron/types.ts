export interface TrackRecord {
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
  fileName: string;
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

/** Per-track karaoke calibration, keyed by the track's absolute path. */
export interface TrackDelayData {
  version: 1;
  offsets: Record<string, number>;
}

export interface CachedLyrics {
  source: string;
  synced: boolean;
  content: string;
  fetchedAt: number;
}

export interface Playlist {
  id: string;
  name: string;
  description?: string;
  trackPaths: string[];
  createdAt: number;
  updatedAt: number;
}

export interface LyricsPayload {
  trackId: number;
  source: string;
  synced: boolean;
  content: string;
  lineCount: number;
  instrumental: boolean;
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

export interface LibraryData {
  version: 1;
  tracks: TrackRecord[];
  /** Active source folders persisted with the library. */
  musicFolders: string[];
  lyrics: Record<string, CachedLyrics[]>;
  settings: Record<string, string>;
}

/** A persisted music source together with the tracks it currently owns. */
export interface MusicFolder {
  path: string;
  trackCount: number;
}

export interface MusicFolderAddResult {
  cancelled: boolean;
  alreadyExists: boolean;
  folders: MusicFolder[];
  summary: ScanSummary | null;
}

export interface MusicFolderRemoveResult {
  folders: MusicFolder[];
  removedTracks: number;
}

export interface MusicFolderRescanResult {
  folders: MusicFolder[];
  summary: ScanSummary | null;
}

export type ReleaseType = "single" | "album" | "ep";

export type ArtistSource = "library" | "manual" | "spotify";

export interface FollowedArtist {
  /** Spotify artist id. */
  id: string;
  /** Display name reported by Spotify. */
  name: string;
  /** Original local-library name that was followed manually. */
  localName: string | null;
  imageUrl: string | null;
  followedAt: number;
  manual: boolean;
  /** Why this artist is tracked. */
  source?: ArtistSource;
}

export interface ReleaseTrack {
  id: string;
  title: string;
  artist: string;
  trackNumber: number;
  durationMs: number;
  spotifyUrl: string;
  previewUrl: string | null;
  isDownloaded: boolean;
  filePath: string | null;
}

export interface ReleaseRecord {
  id: string;
  title: string;
  artist: string;
  artistId: string;
  artistUrl: string | null;
  releaseDate: string;
  releaseDatePrecision: "year" | "month" | "day";
  coverUrl: string | null;
  spotifyUrl: string;
  previewUrl: string | null;
  type: ReleaseType;
  tracks: ReleaseTrack[];
  isDownloaded: boolean;
}

export interface ReleaseFeed {
  version: 1;
  artists: FollowedArtist[];
  releases: ReleaseRecord[];
  lastSyncedAt: number | null;
  lastSyncWarnings: string[];
  authenticated: boolean;
}

export type DownloadTaskStatus =
  | "queued"
  | "downloading"
  | "completed"
  | "failed"
  | "cancelled"
  | "duplicate";

export type DownloadStage =
  | "queued"
  | "mornye"
  | "soulseek"
  | "deezer"
  | "bandcamp"
  | "soundcloud"
  | "youtube"
  | "cropping"
  | "done";

export interface DownloadRequest {
  releaseId: string;
  trackId: string;
  title: string;
  artist: string;
  album: string;
  coverUrl: string | null;
  spotifyUrl: string;
}

export interface DownloadTask {
  id: string;
  releaseId: string;
  trackId: string;
  title: string;
  artist: string;
  album: string;
  coverUrl: string | null;
  spotifyUrl: string;
  status: DownloadTaskStatus;
  stage: DownloadStage;
  source: string | null;
  percent: number;
  speed: string | null;
  message: string | null;
  startedAt: number | null;
  completedAt: number | null;
  filePath: string | null;
}

export interface DownloadSnapshot {
  tasks: DownloadTask[];
  activeCount: number;
  completedCount: number;
}

export interface DownloadCompleteEvent {
  snapshot: DownloadSnapshot;
  completed: DownloadTask[];
  failed: DownloadTask[];
  scan: ScanSummary | null;
  feed: ReleaseFeed;
}
