import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { getSpotifyAccessToken, readSpotifyCookies } from "./spotify-auth.cjs";
import { createSpotifyTrackMatcher } from "./spotify-match";
import { readSpotifyDesktopLikedTracks } from "./spotify-desktop";
import {
  SpotifyWebClient,
  type SpotifyWebDeps,
} from "./spotify-web";
import type { LibraryStore } from "./store";
import type {
  SpotifyLikedSnapshot,
  SpotifyLikedSource,
  SpotifyLikedTrack,
} from "./types";

const WEB_API = "https://api.spotify.com/v1/me/tracks";
const PAGE_SIZE = 50;
const MAX_PAGES = 200;
const REQUEST_TIMEOUT_MS = 20_000;

const HASH_FETCH_LIBRARY =
  "087278b20b743578a6262c2b0b4bcd20d879c503cc359a2285baf083ef944240";

interface CachedSpotifyLikedTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  coverUrl: string | null;
  spotifyUrl: string;
  addedAt: number;
}

interface SpotifyLikedCacheFile {
  version: 1;
  fetchedAt: number;
  source: Exclude<SpotifyLikedSource, "cache">;
  items: CachedSpotifyLikedTrack[];
}

interface ImageSource {
  url?: string;
  width?: number;
  height?: number;
}

interface WebSavedTrack {
  added_at?: string;
  track?: {
    id?: string | null;
    name?: string;
    duration_ms?: number;
    artists?: Array<{ name?: string }>;
    album?: { name?: string; images?: ImageSource[] };
    external_urls?: { spotify?: string };
  } | null;
}

interface WebSavedTrackPage {
  items?: WebSavedTrack[];
  next?: string | null;
}

interface PartnerLibraryTrack {
  addedAt?: { isoString?: string } | string;
  track?: {
    _uri?: string;
    data?: {
      __typename?: string;
      name?: string;
      duration?: { totalMilliseconds?: number };
      albumOfTrack?: {
        name?: string;
        coverArt?: { sources?: ImageSource[] };
      };
      artists?: {
        items?: Array<{ profile?: { name?: string } }>;
      };
    };
  };
}

interface PartnerLibraryPage {
  me?: {
    library?: {
      tracks?: {
        items?: PartnerLibraryTrack[];
        totalCount?: number;
        pagingInfo?: { offset?: number; limit?: number };
      };
    };
  };
}

interface Credentials {
  spDc: string;
  spKey: string;
}

function pickImage(images: ImageSource[] | undefined): string | null {
  if (!images || images.length === 0) return null;
  const sorted = [...images].sort(
    (a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0),
  );
  return sorted.find((image) => image.url)?.url ?? null;
}

function trackIdFromUri(uri: string | undefined): string | null {
  const match = /^spotify:track:([A-Za-z0-9]+)$/.exec(uri ?? "");
  return match?.[1] ?? null;
}

function parseIsoDate(value: unknown): number {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (value && typeof value === "object") {
    const iso = (value as { isoString?: unknown }).isoString;
    return typeof iso === "string" ? parseIsoDate(iso) : 0;
  }
  return 0;
}

function toCachedTrack(
  track: SpotifyLikedTrack | CachedSpotifyLikedTrack,
): CachedSpotifyLikedTrack {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    durationMs: track.durationMs,
    coverUrl: track.coverUrl,
    spotifyUrl: track.spotifyUrl,
    addedAt: track.addedAt,
  };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function resolveCredentials(
  deps: SpotifyWebDeps,
  store: LibraryStore,
): Promise<Credentials | null> {
  const cookies = await readSpotifyCookies(deps.session.defaultSession);
  const spDc =
    cookies.spDc || store.getSetting("spotify_sp_dc")?.trim() || "";
  const spKey =
    cookies.spKey || store.getSetting("spotify_sp_key")?.trim() || "";
  return spDc && spKey ? { spDc, spKey } : null;
}

/** Page through the public Web API endpoint required by the feature spec. */
async function fetchWebLikedTracks(
  token: string,
): Promise<CachedSpotifyLikedTrack[]> {
  const tracks: CachedSpotifyLikedTrack[] = [];
  const visited = new Set<string>();
  let url: string | null = `${WEB_API}?limit=${PAGE_SIZE}`;

  for (let page = 0; url && page < MAX_PAGES; page += 1) {
    if (visited.has(url)) break;
    visited.add(url);
    const response = await fetchWithTimeout(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      const retryAfter = response.headers.get("retry-after");
      throw new Error(
        `Spotify Web API ${response.status}${
          retryAfter ? ` (retry after ${retryAfter}s)` : ""
        }`,
      );
    }
    const data = (await response.json()) as WebSavedTrackPage;
    for (const item of data.items ?? []) {
      const track = item.track;
      const id = track?.id?.trim();
      const title = track?.name?.trim();
      if (!id || !title) continue;
      const artists = (track?.artists ?? [])
        .map((artist) => artist.name?.trim())
        .filter((name): name is string => Boolean(name));
      tracks.push({
        id,
        title,
        artist: artists.join(", "),
        album: track?.album?.name?.trim() ?? "",
        durationMs:
          typeof track?.duration_ms === "number" ? track.duration_ms : 0,
        coverUrl: pickImage(track?.album?.images),
        spotifyUrl:
          track?.external_urls?.spotify ??
          `https://open.spotify.com/track/${id}`,
        addedAt: parseIsoDate(item.added_at),
      });
    }
    url = typeof data.next === "string" && data.next ? data.next : null;
  }
  return tracks;
}

/** Partner GraphQL fallback for accounts where the public API is blocked. */
async function fetchPartnerLikedTracks(
  deps: SpotifyWebDeps,
  credentials: Credentials,
): Promise<CachedSpotifyLikedTrack[]> {
  const client = new SpotifyWebClient(deps);
  await client.configure(credentials.spDc, credentials.spKey);
  const query = (
    client as unknown as {
      query: <T>(
        operationName: string,
        variables: Record<string, unknown>,
        hash: string,
      ) => Promise<T>;
    }
  ).query.bind(client);
  const tracks: CachedSpotifyLikedTrack[] = [];
  try {
    let offset = 0;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const data = await query<PartnerLibraryPage>(
        "fetchLibraryTracks",
        { offset, limit: PAGE_SIZE },
        HASH_FETCH_LIBRARY,
      );
      const library = data.me?.library?.tracks;
      const items = library?.items ?? [];
      for (const item of items) {
        const track = item.track?.data;
        if (track?.__typename !== "Track") continue;
        const id = trackIdFromUri(item.track?._uri);
        const title = track.name?.trim();
        if (!id || !title) continue;
        const artists = (track.artists?.items ?? [])
          .map((artist) => artist.profile?.name?.trim())
          .filter((name): name is string => Boolean(name));
        tracks.push({
          id,
          title,
          artist: artists.join(", "),
          album: track.albumOfTrack?.name?.trim() ?? "",
          durationMs: track.duration?.totalMilliseconds ?? 0,
          coverUrl: pickImage(track.albumOfTrack?.coverArt?.sources),
          spotifyUrl: `https://open.spotify.com/track/${id}`,
          addedAt: parseIsoDate(item.addedAt),
        });
      }
      const total =
        typeof library?.totalCount === "number"
          ? library.totalCount
          : items.length;
      offset += items.length;
      if (items.length === 0 || offset >= total) break;
    }
  } finally {
    client.dispose();
  }
  return tracks;
}

/**
 * Spotify liked-songs source with a local cache.
 *
 * The web-player cookies used by Lyrics+ may belong to a different account
 * than the Spotify desktop client. The desktop collection therefore acts as a
 * fallback when the web account is empty or rate limited. Snapshot matching is
 * always recomputed against the live local library, so newly downloaded files
 * become playable without another network sync.
 */
export class SpotifyLikedStore {
  private cache: SpotifyLikedCacheFile | null = null;
  private cacheLoaded = false;
  private readonly hidden = new Set<string>();
  /** In-memory title+artist matching map; rebuilt only when inputs change. */
  private matchItems: CachedSpotifyLikedTrack[] | null = null;
  private matchRevision = -1;
  private matchPaths = new Map<string, string | null>();

  constructor(
    private readonly file: string,
    private readonly library: LibraryStore,
  ) {}

  private readCache(): SpotifyLikedCacheFile | null {
    if (this.cacheLoaded) return this.cache;
    this.cacheLoaded = true;
    if (!existsSync(this.file)) return null;
    try {
      const parsed = JSON.parse(
        readFileSync(this.file, "utf8"),
      ) as Partial<SpotifyLikedCacheFile>;
      if (
        parsed.version !== 1 ||
        !Array.isArray(parsed.items) ||
        (parsed.source !== "web" &&
          parsed.source !== "partner" &&
          parsed.source !== "desktop")
      ) {
        return null;
      }
      const items = parsed.items
        .filter(
          (item): item is CachedSpotifyLikedTrack =>
            Boolean(item) &&
            typeof item.id === "string" &&
            typeof item.title === "string",
        )
        .map(toCachedTrack);
      this.cache = {
        version: 1,
        fetchedAt:
          typeof parsed.fetchedAt === "number" ? parsed.fetchedAt : 0,
        source: parsed.source,
        items,
      };
      return this.cache;
    } catch (error) {
      console.warn("[spotify-liked] could not read cache:", error);
      return null;
    }
  }

  private writeCache(data: SpotifyLikedCacheFile): void {
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.tmp`;
      writeFileSync(temporary, JSON.stringify(data), "utf8");
      renameSync(temporary, this.file);
      this.cache = data;
      this.cacheLoaded = true;
    } catch (error) {
      console.warn("[spotify-liked] could not write cache:", error);
    }
  }

  private match(
    items: CachedSpotifyLikedTrack[],
  ): SpotifyLikedTrack[] {
    const library = this.library.getTracks();
    const revision = this.library.getRevision();
    if (
      revision !== this.matchRevision ||
      items !== this.matchItems
    ) {
      const findLocal = createSpotifyTrackMatcher(library);
      const paths = new Map<string, string | null>();
      // One local file may satisfy several Spotify entries (for example the
      // same song liked from both a single and an album). Do not consume a
      // match after the first row: every duplicate should show as downloaded.
      for (const item of items) {
        const match = findLocal({
          id: item.id,
          title: item.title,
          artist: item.artist,
          durationMs: item.durationMs,
        });
        paths.set(item.id, match?.path ?? null);
      }

      this.matchItems = items;
      this.matchRevision = revision;
      this.matchPaths = paths;
    }

    return items.map((item) => {
      const localPath = this.matchPaths.get(item.id) ?? null;
      return {
        ...item,
        isDownloaded: Boolean(localPath),
        localPath,
      };
    });
  }

  private snapshot(
    data: SpotifyLikedCacheFile | null,
    authenticated: boolean,
    warnings: string[],
    source: SpotifyLikedSource | null = data?.source ?? null,
  ): SpotifyLikedSnapshot {
    const matched = this.match(data?.items ?? []);
    const items = matched.filter((item) => !this.hidden.has(item.id));
    const downloaded = items.filter((item) => item.isDownloaded).length;
    return {
      version: 1,
      items,
      total: items.length,
      downloaded,
      missing: items.length - downloaded,
      fetchedAt: data?.fetchedAt ?? null,
      source,
      warnings,
      authenticated,
    };
  }

  getSnapshot(authenticated: boolean): SpotifyLikedSnapshot {
    const data = this.readCache();
    return this.snapshot(data, authenticated, []);
  }

  async sync(
    deps: SpotifyWebDeps,
    store: LibraryStore,
    authenticated: boolean,
  ): Promise<SpotifyLikedSnapshot> {
    const warnings: string[] = [];
    const credentials = await resolveCredentials(deps, store);
    let items: CachedSpotifyLikedTrack[] | null = null;
    let source: Exclude<SpotifyLikedSource, "cache"> | null = null;

    if (!credentials) {
      warnings.push("Spotify is not connected. Sign in under Settings → Providers.");
    } else {
      try {
        const token = await getSpotifyAccessToken(
          deps,
          credentials.spDc,
          credentials.spKey,
        );
        if (token.token) {
          try {
            const webItems = await fetchWebLikedTracks(token.token);
            if (webItems.length > 0) {
              items = webItems;
              source = "web";
            } else {
              warnings.push("The signed-in web Spotify account has no liked songs.");
            }
          } catch (error) {
            warnings.push(
              error instanceof Error ? error.message : String(error),
            );
          }
        } else if (token.message) {
          warnings.push(token.message);
        }
      } catch (error) {
        warnings.push(
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    if (!items || items.length === 0) {
      // The desktop client is authoritative for the account that owns the
      // local music library; prefer it over a web account with no likes.
      const desktop = readSpotifyDesktopLikedTracks();
      if (desktop && desktop.tracks.length > 0) {
        items = desktop.tracks.map((track) => ({
          ...track,
          spotifyUrl: `https://open.spotify.com/track/${track.id}`,
        }));
        source = "desktop";
        warnings.push(
          `Loaded ${desktop.tracks.length} liked tracks from the Spotify desktop cache.`,
        );
        if (desktop.missingMetadata > 0) {
          warnings.push(
            `${desktop.missingMetadata} desktop liked tracks had no cached metadata.`,
          );
        }
      }
    }

    if ((!items || items.length === 0) && credentials) {
      try {
        const partnerItems = await fetchPartnerLikedTracks(deps, credentials);
        if (partnerItems.length > 0) {
          items = partnerItems;
          source = "partner";
        } else if (!items || items.length === 0) {
          items = [];
          source = source ?? "partner";
          warnings.push("The signed-in Spotify account has no liked songs.");
        }
      } catch (error) {
        warnings.push(
          `Spotify GraphQL fallback failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    if (items !== null && items.length === 0) {
      const empty: SpotifyLikedCacheFile = {
        version: 1,
        fetchedAt: Date.now(),
        source: source ?? "web",
        items: [],
      };
      this.hidden.clear();
      this.writeCache(empty);
      return this.snapshot(empty, authenticated, warnings);
    }

    if (!items) {
      const cached = this.readCache();
      if (cached) {
        warnings.push(
          "Spotify sync failed; showing the last saved cache.",
        );
        return this.snapshot(cached, authenticated, warnings, "cache");
      }
      throw new Error(
        warnings.length > 0
          ? warnings.join(" ")
          : "Could not load Spotify liked songs.",
      );
    }

    const data: SpotifyLikedCacheFile = {
      version: 1,
      fetchedAt: Date.now(),
      source: source ?? "web",
      items,
    };
    this.hidden.clear();
    this.writeCache(data);
    return this.snapshot(data, authenticated, warnings);
  }

  async setLiked(
    deps: SpotifyWebDeps,
    store: LibraryStore,
    trackId: string,
    liked: boolean,
    authenticated: boolean,
  ): Promise<SpotifyLikedSnapshot> {
    const id = trackId.trim();
    if (!/^[A-Za-z0-9]{22}$/.test(id)) {
      throw new Error("Invalid Spotify track id.");
    }
    const credentials = await resolveCredentials(deps, store);
    if (!credentials) {
      throw new Error(
        "Spotify is not connected. Open Settings → Providers and sign in first.",
      );
    }

    const warnings: string[] = [];
    let saved = false;
    const token = await getSpotifyAccessToken(
      deps,
      credentials.spDc,
      credentials.spKey,
    );
    if (token.token) {
      try {
        const response = await fetchWithTimeout(
          `${WEB_API}?ids=${encodeURIComponent(id)}`,
          {
            method: liked ? "PUT" : "DELETE",
            headers: {
              Authorization: `Bearer ${token.token}`,
              "Content-Type": "application/json",
            },
          },
        );
        if (response.ok) {
          saved = true;
        } else {
          const retryAfter = response.headers.get("retry-after");
          warnings.push(
            `Spotify Web API ${response.status}${
              retryAfter ? ` (retry after ${retryAfter}s)` : ""
            }`,
          );
        }
      } catch (error) {
        warnings.push(
          error instanceof Error ? error.message : String(error),
        );
      }
    } else if (token.message) {
      warnings.push(token.message);
    }

    if (!saved) {
      const client = new SpotifyWebClient(deps);
      try {
        await client.configure(credentials.spDc, credentials.spKey);
        await client.setTrackSaved(id, liked);
        saved = true;
      } finally {
        client.dispose();
      }
    }

    if (liked) this.hidden.delete(id);
    else this.hidden.add(id);

    const snapshot = this.getSnapshot(authenticated);
    return { ...snapshot, warnings };
  }
}
