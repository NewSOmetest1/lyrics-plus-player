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
  lyrics: Record<string, CachedLyrics[]>;
  settings: Record<string, string>;
}
