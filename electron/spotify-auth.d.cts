export interface SpotifyTokenResult {
  token: string | null;
  status: number | null;
  message?: string;
  cached?: boolean;
}

export interface SpotifyCookies {
  spDc: string;
  spKey: string;
}

export interface SpotifyAuthResult extends SpotifyCookies {
  ok: boolean;
  cancelled?: boolean;
  message?: string;
}

export function getSpotifyAccessToken(
  deps: { BrowserWindow: unknown; session: { defaultSession: unknown } },
  spDc: string,
  spKey: string,
  force?: boolean,
): Promise<SpotifyTokenResult>;

export function clearSpotifyTokenCache(): void;

export interface SpotifyWebTrack {
  id: string;
  title: string;
  artist: string;
}

export function searchSpotifyTracksViaWeb(
  deps: { BrowserWindow: unknown; session: { defaultSession: unknown } },
  spDc: string,
  spKey: string,
  query: string,
  timeoutMs?: number,
): Promise<SpotifyWebTrack[]>;

export function readSpotifyCookies(session: unknown): Promise<SpotifyCookies>;

export function cookieHeader(spDc: string, spKey: string): string;

export function loginSpotify(
  deps: {
    BrowserWindow: unknown;
    session: { defaultSession: unknown };
    parent?: unknown;
  },
  store: { setSetting(key: string, value: string): void },
  notify?: (payload: { ok: boolean; spDc?: string; spKey?: string }) => void,
): Promise<SpotifyAuthResult>;

export function logoutSpotify(deps: {
  session?: { defaultSession: unknown };
}): Promise<{ ok: boolean; message?: string }>;

export function statusMessage(status: number): string;
