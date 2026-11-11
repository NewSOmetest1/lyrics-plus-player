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
  /**
   * Optional artwork URL used for palette extraction only. Old libraries do
   * not have it; it lets migrated covers keep their exact pre-migration
   * accent colors without decoding a full-size file repeatedly.
   */
  coverPalettePath?: string | null;
  hasEmbeddedLyrics: boolean;
  addedAt: number;
}

export interface TrackStatsRecord {
  playCount: number;
  /** Actual listening time in seconds. */
  totalListenTime: number;
  lastPlayedTimestamp: number;
}

/** One local calendar day of listening, keyed by `YYYY-MM-DD`. */
export interface StatsDayRecord {
  /** Actual listening time on this day, in seconds. */
  listenTime: number;
  /** Credited plays on this day. */
  plays: number;
  /** Listening time per track path on this day, in seconds. */
  tracks: Record<string, number>;
}

export interface StatsData {
  version: 2;
  tracks: Record<string, TrackStatsRecord>;
  /** Daily buckets for the activity heatmap and listening memories. */
  days: Record<string, StatsDayRecord>;
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

/** Result of deleting one library track's audio file from disk. */
export interface TrackFileDeleteResult {
  path: string;
  title: string;
  /** True when the record existed but the file was already gone. */
  fileMissing: boolean;
}

export interface MusicFolderRescanResult {
  folders: MusicFolder[];
  summary: ScanSummary | null;
}

export type ReleaseType = "single" | "album" | "ep";

export type ArtistSource = "library" | "manual" | "spotify";

export type SpotifyLikedSource = "web" | "partner" | "desktop" | "cache";

/**
 * Catalog metadata supplied when a track is liked from the app, so the local
 * liked-songs mirror can show it immediately instead of waiting for a sync.
 */
export interface SpotifyLikedTrackInput {
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  coverUrl: string | null;
  spotifyUrl: string;
  /** Local file path, used by the renderer's optimistic Liked Songs row. */
  localPath?: string | null;
}

/** Persisted artist profile used by cards and artist pages. */
export interface SpotifyArtistCacheEntry {
  id: string;
  name: string;
  imageUrl: string | null;
  genres: string[];
  followers: number;
  monthlyListeners: number;
  popularity: number;
  spotifyUrl: string;
  fetchedAt: number;
}

/** One track from the user's Spotify liked-songs collection. */
export interface SpotifyLikedTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  coverUrl: string | null;
  spotifyUrl: string;
  addedAt: number;
  /** True when the track was matched to a file in the local library. */
  isDownloaded: boolean;
  localPath: string | null;
}

export interface SpotifyLikedSnapshot {
  version: 1;
  items: SpotifyLikedTrack[];
  total: number;
  downloaded: number;
  missing: number;
  fetchedAt: number | null;
  source: SpotifyLikedSource | null;
  warnings: string[];
  authenticated: boolean;
}

/** Signed-in Spotify account shown in Options → Providers. */
export interface SpotifyProfile {
  ok: boolean;
  id: string | null;
  displayName: string | null;
  product: string | null;
  source: "web" | "partner" | null;
  status: number | null;
  error: string | null;
  /** Non-fatal note, e.g. the public API was rate limited. */
  notice: string | null;
}

/** Artist metadata from Spotify's catalog, used by search and artist pages. */
export interface SpotifyArtistSummary {
  id: string;
  name: string;
  imageUrl: string | null;
  genres: string[];
  followers: number;
  monthlyListeners: number;
  popularity: number;
  spotifyUrl: string;
}

export interface SpotifyAlbumSummary {
  id: string;
  title: string;
  artist: string;
  artists: string[];
  releaseDate: string;
  releaseDatePrecision: "year" | "month" | "day";
  coverUrl: string | null;
  spotifyUrl: string;
  totalTracks: number;
  type: string;
}

export interface SpotifyCatalogTrack {
  id: string;
  title: string;
  artist: string;
  artists: string[];
  album: string;
  albumId: string | null;
  coverUrl: string | null;
  durationMs: number;
  trackNumber: number;
  spotifyUrl: string;
}

export interface SpotifySearchCatalog {
  query: string;
  artists: SpotifyArtistSummary[];
  albums: SpotifyAlbumSummary[];
  tracks: SpotifyCatalogTrack[];
  warnings: string[];
}

export interface SpotifyArtistCatalog {
  artist: SpotifyArtistSummary;
  topTracks: SpotifyCatalogTrack[];
  albums: SpotifyAlbumSummary[];
  /** Newest release from Spotify's DATE_DESC discography query. */
  latestRelease: SpotifyAlbumSummary | null;
  warnings: string[];
}

/** Full album page payload: metadata plus its Spotify tracklist. */
export interface SpotifyAlbumCatalog {
  album: SpotifyAlbumSummary;
  tracks: SpotifyCatalogTrack[];
  warnings: string[];
}

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

/** Quality preset offered by the artwork context menu. */
export type CoverQuality = "max" | "spotify" | "deezer" | "640";

export interface CoverTarget {
  artist: string;
  album: string;
  year?: string | null;
  /** Current Spotify image URL, used for the 2000px CDN rewrite. */
  spotifyImageUrl?: string | null;
  spotifyAlbumId?: string | null;
  /**
   * Local cached artwork (`media://covers/?file=...`) used as a visual
   * reference so a loose search match cannot replace the album's art.
   */
  referenceCoverUrl?: string | null;
}

export interface CoverDownloadRequest {
  target: CoverTarget;
  quality: CoverQuality;
  /** Ask for a destination through the native save dialog. */
  saveAs?: boolean;
}

export interface CoverDownloadResult {
  canceled: boolean;
  path: string | null;
  displayPath: string | null;
  folder: string;
  width: number;
  height: number;
  source: string;
  bytes: number;
}
