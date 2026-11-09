import type {
  LyricsPayload,
  MusicFolder,
  MusicFolderAddResult,
  MusicFolderRemoveResult,
  MusicFolderRescanResult,
  Playlist,
  ScanProgress,
  ScanSummary,
  TrackRecord,
} from "./types";

export type {
  LyricsPayload,
  MusicFolder,
  MusicFolderAddResult,
  MusicFolderRemoveResult,
  MusicFolderRescanResult,
  Playlist,
  ScanProgress,
  ScanSummary,
  TrackRecord,
};
export type {
  ArtistSource,
  DownloadCompleteEvent,
  DownloadRequest,
  DownloadSnapshot,
  DownloadStage,
  DownloadTask,
  DownloadTaskStatus,
  FollowedArtist,
  ReleaseFeed,
  ReleaseRecord,
  ReleaseTrack,
  ReleaseType,
  SpotifyLikedSnapshot,
  SpotifyLikedSource,
  SpotifyLikedTrack,
  SpotifyArtistSummary,
  SpotifyAlbumSummary,
  SpotifyCatalogTrack,
  SpotifySearchCatalog,
  SpotifyArtistCatalog,
  SpotifyAlbumCatalog,
} from "./types";

export interface SpotifyAuthStatus {
  authenticated: boolean;
  hasSpDc: boolean;
  hasSpKey: boolean;
}

export interface SpotifyAuthResult {
  ok: boolean;
  cancelled?: boolean;
  message?: string;
  spDc?: string;
  spKey?: string;
}

export interface ElectronAPI {
  isElectron: true;
  invoke<T = unknown>(channel: string, payload?: unknown): Promise<T>;
  on<T = unknown>(channel: string, listener: (payload: T) => void): () => void;
  selectFolder(): Promise<string | null>;
  window: {
    minimize(): Promise<void>;
    toggleMaximize(): Promise<void>;
    close(): Promise<void>;
    isMaximized(): Promise<boolean>;
    onMaximized(listener: (maximized: boolean) => void): () => void;
    resizeStart(direction: string): Promise<void>;
    resizeEnd(): Promise<void>;
  };
}
