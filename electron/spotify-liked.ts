import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  getSpotifyAccessToken,
  readSpotifyCookies,
  searchSpotifyTracksViaWeb,
} from "./spotify-auth.cjs";
import { createSpotifyTrackMatcher } from "./spotify-match";
import {
  SpotifyWebClient,
  type SpotifyWebDeps,
} from "./spotify-web";
import type { LibraryStore } from "./store";
import type {
  SpotifyLikedSnapshot,
  SpotifyLikedSource,
  SpotifyLikedTrack,
  SpotifyLikedTrackInput,
  SpotifyProfile,
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
  /**
   * Likes/unlikes made inside the app, kept until the Spotify source catches
   * up. A full sync otherwise drops a just-liked track when the source cache
   * (or a different signed-in account) has not seen it yet.
   */
  overrides?: Record<string, CachedSpotifyOverride>;
}

interface CachedSpotifyOverride {
  liked: boolean;
  updatedAt: number;
  /** Metadata needed to re-add an optimistic like after a sync. */
  track?: CachedSpotifyLikedTrack;
}

function preserveLikedOrder(
  previous: CachedSpotifyLikedTrack[],
  fetched: CachedSpotifyLikedTrack[],
): CachedSpotifyLikedTrack[] {
  if (previous.length === 0) return fetched;
  const fetchedById = new Map(fetched.map((item) => [item.id, item]));
  const previousIds = new Set(previous.map((item) => item.id));
  const result: CachedSpotifyLikedTrack[] = [];
  // New Spotify-side additions go first, in the order the source returned.
  for (const item of fetched) {
    if (!previousIds.has(item.id)) result.push(item);
  }
  // Rows the user already saw keep their order, so a sync does not reshuffle
  // the whole list when the source returns a different ordering.
  for (const item of previous) {
    const current = fetchedById.get(item.id);
    if (current) result.push(current);
  }
  return result;
}

function mergeLikedOverrides(
  items: CachedSpotifyLikedTrack[],
  overrides?: Record<string, CachedSpotifyOverride>,
): {
  items: CachedSpotifyLikedTrack[];
  overrides?: Record<string, CachedSpotifyOverride>;
} {
  if (!overrides || Object.keys(overrides).length === 0) {
    return { items };
  }
  const present = new Set(items.map((item) => item.id));
  const removed = new Set<string>();
  const pending: CachedSpotifyLikedTrack[] = [];
  const next: Record<string, CachedSpotifyOverride> = {};

  for (const [id, override] of Object.entries(overrides)) {
    const inSource = present.has(id);
    if (override.liked) {
      if (inSource) continue; // Source caught up: drop the local override.
      if (!override.track) continue;
      pending.push(override.track);
      next[id] = override;
      continue;
    }
    if (inSource) {
      removed.add(id);
      next[id] = override;
    }
  }

  return {
    items: [
      ...pending,
      ...items.filter((item) => !removed.has(item.id)),
    ],
    overrides: Object.keys(next).length > 0 ? next : undefined,
  };
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

function spotifyLikeError(
  status: number,
  statusText: string,
  body: string,
): string {
  const detail = body.replace(/\s+/g, " ").trim().slice(0, 400);
  return `Spotify Like Error: ${status} ${statusText || "Request failed"}${
    detail ? ` — ${detail}` : ""
  }`;
}

/** Resolve a missing Spotify id through the public search, then the web UI. */
async function searchSpotifyTrackId(
  deps: SpotifyWebDeps,
  credentials: Credentials,
  token: string | null,
  input: SpotifyLikedTrackInput | null,
): Promise<string | null> {
  const title = input?.title.trim() ?? "";
  const artist = input?.artist.trim() ?? "";
  const query = [artist, title].filter(Boolean).join(" ").trim();
  if (!query) return null;

  if (token) {
    const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(
      query,
    )}&type=track&limit=1`;
    try {
      const response = await fetchWithTimeout(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      });
      const body = await response.text();
      if (response.ok) {
        const parsed = JSON.parse(body) as {
          tracks?: { items?: Array<{ id?: string }> };
        };
        const id = parsed.tracks?.items?.[0]?.id?.trim();
        if (id) return id;
      } else {
        console.error(
          `[spotify-liked] GET /v1/search -> ${response.status} ${response.statusText}`,
          body,
        );
      }
    } catch (error) {
      console.error("[spotify-liked] Spotify search request failed", error);
    }
  }

  try {
    const rows = await searchSpotifyTracksViaWeb(
      deps,
      credentials.spDc,
      credentials.spKey,
      query,
    );
    return rows[0]?.id?.trim() ?? null;
  } catch (error) {
    console.error("[spotify-liked] Spotify web search failed", error);
    return null;
  }
}

/** Read the signed-in account for Options → Providers. */
export async function fetchSpotifyProfile(
  deps: SpotifyWebDeps,
  store: LibraryStore,
): Promise<SpotifyProfile> {
  const credentials = await resolveCredentials(deps, store);
  if (!credentials) {
    return {
      ok: false,
      id: null,
      displayName: null,
      product: null,
      source: null,
      status: null,
      error: "Spotify is not connected.",
      notice: null,
    };
  }

  let webStatus: number | null = null;
  let webError: string | null = null;
  const token = await getSpotifyAccessToken(
    deps,
    credentials.spDc,
    credentials.spKey,
  ).catch((error: unknown) => {
    console.error("[spotify-profile] token request failed", error);
    return {
      token: null,
      status: null,
      message: error instanceof Error ? error.message : String(error),
    };
  });

  if (token.token) {
    try {
      const response = await fetchWithTimeout("https://api.spotify.com/v1/me", {
        headers: {
          Authorization: `Bearer ${token.token}`,
          Accept: "application/json",
        },
      });
      webStatus = response.status;
      const body = await response.text();
      if (response.ok) {
        const profile = JSON.parse(body) as {
          id?: string;
          display_name?: string;
          product?: string;
        };
        return {
          ok: true,
          id: profile.id?.trim() || null,
          displayName:
            profile.display_name?.trim() || profile.id?.trim() || null,
          product: profile.product ?? null,
          source: "web",
          status: response.status,
          error: null,
          notice: null,
        };
      }
      webError = `Spotify Profile Error: ${response.status} ${response.statusText}`;
      console.error(
        `[spotify-profile] GET /v1/me -> ${response.status} ${response.statusText}`,
        body,
      );
    } catch (error) {
      webError = `Spotify Profile Error: ${
        error instanceof Error ? error.message : String(error)
      }`;
      console.error("[spotify-profile] GET /v1/me failed", error);
    }
  } else if (token.message) {
    webError = `Spotify Profile Error: ${token.message}`;
  }

  const client = new SpotifyWebClient(deps);
  try {
    await client.configure(credentials.spDc, credentials.spKey);
    const profile = await client.getProfile();
    return {
      ok: true,
      id: profile.id,
      displayName: profile.displayName,
      product: null,
      source: "partner",
      status: webStatus,
      error: null,
      notice: webError,
    };
  } catch (error) {
    console.error("[spotify-profile] web-session profile failed", error);
    const partnerError = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      id: null,
      displayName: null,
      product: null,
      source: null,
      status: webStatus,
      error: [webError, partnerError].filter(Boolean).join("; "),
      notice: null,
    };
  } finally {
    client.dispose();
  }
}

/**
 * Spotify liked-songs source with a local cache.
 *
 * Likes are written to the Spotify Web API first (PUT/DELETE /v1/me/tracks).
 * If that endpoint is rate limited, the same signed-in web session is used
 * through GraphQL. The desktop cache is deliberately not read: the signed-in
 * account must be the source of truth.
 */
export class SpotifyLikedStore {
  private cache: SpotifyLikedCacheFile | null = null;
  private cacheLoaded = false;
  private readonly hidden = new Set<string>();
  /** In-memory title+artist matching map; rebuilt only when inputs change. */
  private matchItems: CachedSpotifyLikedTrack[] | null = null;
  private matchRevision = -1;
  private matchPaths = new Map<string, string | null>();

  private cacheWriteTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingCacheWrite: SpotifyLikedCacheFile | null = null;

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
      const overrides: Record<string, CachedSpotifyOverride> = {};
      if (parsed.overrides && typeof parsed.overrides === "object") {
        for (const [id, value] of Object.entries(parsed.overrides)) {
          if (!value || typeof value !== "object") continue;
          const record = value as Partial<CachedSpotifyOverride>;
          if (
            typeof record.liked !== "boolean" ||
            typeof record.updatedAt !== "number"
          ) {
            continue;
          }
          overrides[id] = {
            liked: record.liked,
            updatedAt: record.updatedAt,
            track: record.track ? toCachedTrack(record.track) : undefined,
          };
        }
      }
      this.cache = {
        version: 1,
        fetchedAt:
          typeof parsed.fetchedAt === "number" ? parsed.fetchedAt : 0,
        source: parsed.source,
        items,
        overrides:
          Object.keys(overrides).length > 0 ? overrides : undefined,
      };
      return this.cache;
    } catch (error) {
      console.warn("[spotify-liked] could not read cache:", error);
      return null;
    }
  }

  private writeCache(
    data: SpotifyLikedCacheFile,
    immediate = false,
  ): void {
    this.cache = data;
    this.cacheLoaded = true;
    if (immediate) {
      this.persistCache(data);
      return;
    }
    this.pendingCacheWrite = data;
    if (this.cacheWriteTimer !== null) clearTimeout(this.cacheWriteTimer);
    this.cacheWriteTimer = setTimeout(() => {
      this.cacheWriteTimer = null;
      const pending = this.pendingCacheWrite;
      this.pendingCacheWrite = null;
      if (pending) this.persistCache(pending);
    }, 400);
  }

  /** Write any coalesced like update before the process exits. */
  flushCache(): void {
    if (this.cacheWriteTimer !== null) {
      clearTimeout(this.cacheWriteTimer);
      this.cacheWriteTimer = null;
    }
    const pending = this.pendingCacheWrite;
    this.pendingCacheWrite = null;
    if (pending) this.persistCache(pending);
  }

  private persistCache(data: SpotifyLikedCacheFile): void {
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.tmp`;
      writeFileSync(temporary, JSON.stringify(data), "utf8");
      renameSync(temporary, this.file);
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
    const merged = mergeLikedOverrides(
      data?.items ?? [],
      data?.overrides,
    );
    const matched = this.match(merged.items);
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

    if ((!items || items.length === 0) && credentials) {
      // The public Web API is frequently rate limited for web-player tokens.
      // Fall back to the same signed-in session's GraphQL endpoint rather than
      // reading the Spotify desktop cache.
      try {
        const partnerTracks = await fetchPartnerLikedTracks(deps, credentials);
        if (partnerTracks.length > 0) {
          items = partnerTracks;
          source = "partner";
          warnings.push(
            `Web API unavailable; loaded ${partnerTracks.length} liked tracks through the Spotify web session.`,
          );
        } else if (!items) {
          items = [];
          source = "partner";
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

    const cached = this.readCache();
    const overrides = cached?.overrides;
    if (items !== null && items.length === 0) {
      const merged = mergeLikedOverrides([], overrides);
      const empty: SpotifyLikedCacheFile = {
        version: 1,
        fetchedAt: Date.now(),
        source: source ?? "web",
        items: merged.items,
        overrides: merged.overrides,
      };
      this.hidden.clear();
      this.writeCache(empty, true);
      return this.snapshot(empty, authenticated, warnings);
    }

    if (!items) {
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

    const ordered = preserveLikedOrder(cached?.items ?? [], items);
    const merged = mergeLikedOverrides(ordered, overrides);
    const data: SpotifyLikedCacheFile = {
      version: 1,
      fetchedAt: Date.now(),
      source: source ?? "web",
      items: merged.items,
      overrides: merged.overrides,
    };
    this.hidden.clear();
    this.writeCache(data, true);
    return this.snapshot(data, authenticated, warnings);
  }

  /**
   * Keep the local mirror in step with an immediate like/unlike. Without this
   * the heart only wrote to Spotify, while the Liked Songs page kept showing
   * the previous cache until a full sync.
   */
  private updateCache(
    id: string,
    liked: boolean,
    input: SpotifyLikedTrackInput | null,
  ): void {
    const cached = this.readCache();
    if (!liked) {
      const overrides = {
        ...(cached?.overrides ?? {}),
        [id]: { liked: false, updatedAt: Date.now() },
      };
      // Record the unlike even when the track was not in the cached list, so
      // a later stale source pull cannot bring it back.
      this.writeCache({
        version: 1,
        fetchedAt: Date.now(),
        source: cached?.source ?? "web",
        items: (cached?.items ?? []).filter((item) => item.id !== id),
        overrides,
      });
      return;
    }

    const existing = cached?.items.find((item) => item.id === id);
    const title = input?.title.trim() ?? "";
    const artist = input?.artist.trim() ?? "";
    const durationMs =
      typeof input?.durationMs === "number" &&
      Number.isFinite(input.durationMs)
        ? Math.max(0, input.durationMs)
        : 0;
    const item: CachedSpotifyLikedTrack | null =
      existing ??
      (title && artist
        ? {
            id,
            title,
            artist,
            album: input?.album.trim() ?? "",
            durationMs,
            coverUrl: input?.coverUrl ?? null,
            spotifyUrl:
              input?.spotifyUrl?.trim() ||
              `https://open.spotify.com/track/${id}`,
            addedAt: Date.now(),
          }
        : null);
    if (!item) return;

    this.writeCache({
      version: 1,
      // Treat the optimistic update as fresh: a full pull immediately after
      // liking could otherwise resurrect a stale source snapshot without it.
      fetchedAt: Date.now(),
      source: cached?.source ?? "web",
      items: [
        item,
        ...(cached?.items ?? []).filter((entry) => entry.id !== id),
      ],
      overrides: {
        ...(cached?.overrides ?? {}),
        [id]: { liked: true, updatedAt: Date.now(), track: item },
      },
    });
  }

  async setLiked(
    deps: SpotifyWebDeps,
    store: LibraryStore,
    trackId: string,
    liked: boolean,
    authenticated: boolean,
    input: SpotifyLikedTrackInput | null = null,
  ): Promise<SpotifyLikedSnapshot> {
    let id = trackId.trim();
    const credentials = await resolveCredentials(deps, store);
    if (!credentials) {
      throw new Error(
        "Spotify Like Error: Spotify is not connected. Open Settings → Providers and sign in.",
      );
    }

    const token = await getSpotifyAccessToken(
      deps,
      credentials.spDc,
      credentials.spKey,
    ).catch((error: unknown) => {
      console.error("[spotify-liked] token request failed", error);
      return {
        token: null,
        status: null,
        message: error instanceof Error ? error.message : String(error),
      };
    });

    if (!/^[A-Za-z0-9]{22}$/.test(id)) {
      const resolved = await searchSpotifyTrackId(
        deps,
        credentials,
        token?.token ?? null,
        input,
      );
      if (!resolved) throw new Error("Could not match Spotify ID");
      id = resolved;
    }

    const warnings: string[] = [];
    let saved = false;
    let webError: string | null = null;

    if (token?.token) {
      try {
        const response = await fetchWithTimeout(
          `${WEB_API}?ids=${encodeURIComponent(id)}`,
          {
            method: liked ? "PUT" : "DELETE",
            headers: {
              Authorization: `Bearer ${token.token}`,
              "Content-Type": "application/json",
              Accept: "application/json",
            },
          },
        );
        const body = await response.text();
        if (response.ok) {
          saved = true;
        } else {
          webError = spotifyLikeError(
            response.status,
            response.statusText,
            body,
          );
          console.error(
            `[spotify-liked] ${liked ? "PUT" : "DELETE"} /v1/me/tracks?ids=${id} -> ${response.status} ${response.statusText}`,
            body,
          );
        }
      } catch (error) {
        webError = `Spotify Like Error: ${
          error instanceof Error ? error.message : String(error)
        }`;
        console.error("[spotify-liked] Web API like request failed", error);
      }
    } else if (token?.message) {
      webError = `Spotify Like Error: ${token.message}`;
      console.error("[spotify-liked] no access token:", token.message);
    }

    if (!saved) {
      const client = new SpotifyWebClient(deps);
      try {
        await client.configure(credentials.spDc, credentials.spKey);
        await client.setTrackSaved(id, liked);
        saved = true;
        console.log(
          `[spotify-liked] ${
            liked ? "saved" : "removed"
          } ${id} through the Spotify web session (Web API: ${
            webError ?? "unknown error"
          })`,
        );
      } catch (error) {
        console.error(
          "[spotify-liked] Spotify web-session like request failed",
          error,
        );
        const partnerError =
          error instanceof Error ? error.message : String(error);
        webError = webError
          ? `${webError}. Spotify web-session fallback failed: ${partnerError}`
          : `Spotify Like Error: ${partnerError}`;
      } finally {
        client.dispose();
      }
    }

    // Rollback is the renderer's job: nothing below runs when Spotify did not
    // actually accept the change, so the persisted mirror never drifts.
    if (!saved) {
      throw new Error(webError ?? "Spotify Like Error: request failed.");
    }

    if (liked) this.hidden.delete(id);
    else this.hidden.add(id);
    this.updateCache(id, liked, input);

    if (webError) {
      warnings.push(
        `Web API fallback: ${webError.replace(
          / — .*$/s,
          "",
        )}; saved through the Spotify web session.`,
      );
    }

    const snapshot = this.getSnapshot(authenticated);
    return { ...snapshot, warnings: [...snapshot.warnings, ...warnings] };
  }
}
