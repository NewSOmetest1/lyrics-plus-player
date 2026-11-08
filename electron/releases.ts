import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { readSpotifyCookies } from "./spotify-auth.cjs";
import { readSpotifyDesktopFollowedArtists } from "./spotify-desktop";
import {
  SpotifyWebClient,
  type SpotifyWebDeps,
  type SpotifyWebRelease,
  type SpotifyWebTrack,
} from "./spotify-web";
import type { LibraryStore } from "./store";
import type {
  FollowedArtist,
  ReleaseFeed,
  ReleaseRecord,
  ReleaseTrack,
  ReleaseType,
  TrackRecord,
} from "./types";

const REQUEST_TIMEOUT_MS = 15_000;
const SYNC_CONCURRENCY = 6;
const PREVIEW_CACHE_LIMIT = 500;
/** Only releases from this window make up the feed. */
const RECENT_RELEASE_DAYS = 28;
const DISCOGRAPHY_LIMIT = 12;
const SEARCH_LIMIT = 5;
const previewCache = new Map<string, string | null>();

const EMBED_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

interface PersistedReleaseData {
  version: 1;
  artists: FollowedArtist[];
  releases: ReleaseRecord[];
  lastSyncedAt: number | null;
  lastSyncWarnings: string[];
}

const EMPTY: PersistedReleaseData = {
  version: 1,
  artists: [],
  releases: [],
  lastSyncedAt: null,
  lastSyncWarnings: [],
};

function normalizeName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Normalize a song title, dropping features, brackets and version markers. */
function titleKey(value: string): string {
  return normalizeName(
    value
      .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
      .replace(/\b(feat|ft|featuring)\b.*$/i, " ")
      .replace(
        /\b(explicit|remaster(?:ed)?|deluxe|bonus|single version|album version)\b/gi,
        " ",
      ),
  );
}

function artistKeys(value: string): string[] {
  const keys = new Set<string>();
  const full = normalizeName(value);
  if (full) keys.add(full);
  for (const part of value.split(
    /\s*(?:,|;|&|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b)\s*/i,
  )) {
    const key = normalizeName(part);
    if (key) keys.add(key);
  }
  return [...keys];
}

/**
 * Mirror `src/lib/artists.ts` so backend tracking sees the exact same artist
 * names as the library UI. Handles "A, B", "A feat. B", "A / B", "A w/ B".
 */
function splitArtistNames(value: string): string[] {
  const normalized = value
    .replace(/\bw\/\s*/gi, " & ")
    .replace(/\s+\b(?:feat(?:uring)?|ft|vs)\.?\s+/gi, " & ")
    .replace(/\s*\/\s*/g, " & ")
    .trim();
  if (!normalized) return [];

  const seen = new Set<string>();
  const names: string[] = [];
  for (const part of normalized.split(/\s*[,;&]\s*/)) {
    const name = part.replace(/\s+/g, " ").trim();
    if (!name) continue;
    const key = normalizeName(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function releaseTypeFromWeb(type: string): ReleaseType {
  if (type === "SINGLE") return "single";
  if (type === "EP") return "ep";
  return "album";
}

function trackFromWeb(
  item: SpotifyWebTrack,
  fallbackArtist: string,
): ReleaseTrack {
  return {
    id: item.id,
    title: item.title,
    artist: item.artist.trim() || fallbackArtist,
    trackNumber: item.trackNumber,
    durationMs: item.durationMs,
    spotifyUrl: item.spotifyUrl,
    previewUrl: null,
    isDownloaded: false,
    filePath: null,
  };
}

function releaseTimestamp(
  date: string,
  precision: "year" | "month" | "day",
): number {
  if (!date) return 0;
  const full =
    precision === "year"
      ? `${date}-01-01`
      : precision === "month"
        ? `${date}-01`
        : date;
  const parsed = Date.parse(`${full}T00:00:00Z`);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortReleases(releases: ReleaseRecord[]): ReleaseRecord[] {
  return [...releases].sort(
    (a, b) =>
      releaseTimestamp(b.releaseDate, b.releaseDatePrecision) -
        releaseTimestamp(a.releaseDate, a.releaseDatePrecision) ||
      a.title.localeCompare(b.title, "en", { sensitivity: "base" }),
  );
}

/**
 * Pick the newest singles/albums for an artist and keep only releases from
 * the recent window. Spotify returns discography items in DATE_DESC order,
 * but sorting locally keeps the feed correct if that ever changes.
 */
function recentArtistReleases(
  releases: SpotifyWebRelease[],
  now: number,
): SpotifyWebRelease[] {
  const cutoff = now - RECENT_RELEASE_DAYS * 86_400_000;
  return releases
    .filter((release) => release.type === "SINGLE" || release.type === "ALBUM")
    .filter(
      (release) =>
        releaseTimestamp(release.releaseDate, release.releaseDatePrecision) >=
        cutoff,
    )
    .sort(
      (a, b) =>
        releaseTimestamp(b.releaseDate, b.releaseDatePrecision) -
        releaseTimestamp(a.releaseDate, a.releaseDatePrecision),
    );
}

/** Prefer the credited artists Spotify reports for the release itself. */
function releaseArtistFromTracks(
  tracks: ReleaseTrack[],
  fallback: string,
): string {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const track of tracks) {
    for (const name of splitArtistNames(track.artist)) {
      const key = normalizeName(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      names.push(name);
    }
  }
  return names.join(", ") || fallback;
}

/**
 * Spotify's Web API now returns `preview_url: null` for many tokens, but the
 * public embed player still ships the 30-second `audioPreview` URL. Resolve it
 * lazily in the main process so the renderer can play previews without CORS.
 */
export async function resolvePreviewUrl(
  trackId: string,
): Promise<string | null> {
  const id = trackId.trim();
  if (!/^[A-Za-z0-9]{5,40}$/.test(id)) return null;
  if (previewCache.has(id)) return previewCache.get(id) ?? null;

  let resolved: string | null = null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(
      `https://open.spotify.com/embed/track/${id}`,
      {
        headers: {
          Accept: "text/html",
          "User-Agent": EMBED_USER_AGENT,
        },
        signal: controller.signal,
      },
    );
    if (response.ok) {
      const html = await response.text();
      const match = /"audioPreview"\s*:\s*\{\s*"url"\s*:\s*"([^"]+)"/.exec(html);
      const url = match?.[1]
        .replace(/\\u002F/gi, "/")
        .replace(/\\\//g, "/");
      if (url?.startsWith("https://")) resolved = url;
    }
  } catch (error) {
    console.warn("[releases] preview lookup failed:", error);
  } finally {
    clearTimeout(timer);
  }

  if (previewCache.size >= PREVIEW_CACHE_LIMIT) previewCache.clear();
  previewCache.set(id, resolved);
  return resolved;
}

async function spotifyCredentials(
  deps: SpotifyWebDeps,
  store: LibraryStore,
): Promise<{ spDc: string; spKey: string }> {
  const cookies = await readSpotifyCookies(deps.session.defaultSession);
  const spDc = cookies.spDc || store.getSetting("spotify_sp_dc")?.trim() || "";
  const spKey =
    cookies.spKey || store.getSetting("spotify_sp_key")?.trim() || "";
  if (!spDc || !spKey) {
    throw new Error(
      "Spotify is not connected. Open Settings → Providers and sign in first.",
    );
  }
  return { spDc, spKey };
}

export class ReleasesStore {
  private data: PersistedReleaseData;
  private web: SpotifyWebClient | null = null;

  constructor(
    private readonly file: string,
    private readonly library: LibraryStore,
    private readonly getHistoryFile: () => string,
  ) {
    mkdirSync(path.dirname(file), { recursive: true });
    this.data = this.read();
    this.refreshDownloadedStatus(false);
  }

  private read(): PersistedReleaseData {
    if (!existsSync(this.file)) return structuredClone(EMPTY);
    try {
      const parsed = JSON.parse(
        readFileSync(this.file, "utf8"),
      ) as Partial<PersistedReleaseData>;
      return {
        version: 1,
        artists: Array.isArray(parsed.artists)
          ? parsed.artists
              .filter(
                (artist): artist is FollowedArtist =>
                  Boolean(
                    artist &&
                      typeof artist.id === "string" &&
                      typeof artist.name === "string",
                  ),
              )
              .map((artist) => ({
                id: artist.id,
                name: artist.name,
                localName:
                  typeof artist.localName === "string" ? artist.localName : null,
                imageUrl:
                  typeof artist.imageUrl === "string" ? artist.imageUrl : null,
                followedAt:
                  Number.isFinite(artist.followedAt) && artist.followedAt > 0
                    ? artist.followedAt
                    : Date.now(),
                manual: Boolean(artist.manual),
                source:
                  artist.source === "library" ||
                  artist.source === "manual" ||
                  artist.source === "spotify"
                    ? artist.source
                    : artist.manual
                      ? "manual"
                      : "library",
              }))
          : [],
        releases: Array.isArray(parsed.releases)
          ? parsed.releases
              .filter(
                (release): release is ReleaseRecord =>
                  Boolean(
                    release &&
                      typeof release.id === "string" &&
                      typeof release.title === "string" &&
                      typeof release.artistId === "string",
                  ),
              )
              .map((release) => ({
                ...release,
                tracks: Array.isArray(release.tracks)
                  ? release.tracks.map((track) => ({
                      ...track,
                      isDownloaded: Boolean(track.isDownloaded),
                      filePath: track.filePath ?? null,
                      previewUrl: track.previewUrl ?? null,
                    }))
                  : [],
                isDownloaded: Boolean(release.isDownloaded),
              }))
          : [],
        lastSyncedAt:
          Number.isFinite(parsed.lastSyncedAt) && (parsed.lastSyncedAt ?? 0) > 0
            ? (parsed.lastSyncedAt as number)
            : null,
        lastSyncWarnings: Array.isArray(parsed.lastSyncWarnings)
          ? parsed.lastSyncWarnings.filter(
              (warning): warning is string => typeof warning === "string",
            )
          : [],
      };
    } catch (error) {
      console.error(
        "[releases] could not read followed-artists.json, starting empty:",
        error,
      );
      return structuredClone(EMPTY);
    }
  }

  private save(): void {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.file);
  }

  getFeed(authenticated = false): ReleaseFeed {
    return {
      version: 1,
      artists: this.data.artists.map((artist) => ({ ...artist })),
      releases: this.data.releases.map((release) => ({
        ...release,
        tracks: release.tracks.map((track) => ({ ...track })),
      })),
      lastSyncedAt: this.data.lastSyncedAt,
      lastSyncWarnings: [...this.data.lastSyncWarnings],
      authenticated,
    };
  }

  private readDownloadedHistory(): Map<string, string> {
    const history = new Map<string, string>();
    try {
      const file = this.getHistoryFile();
      if (!existsSync(file)) return history;
      for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
        if (!line.trim()) continue;
        const [trackId, filePath] = line.split("\t");
        if (!trackId || !filePath) continue;
        if (!existsSync(filePath)) continue;
        history.set(trackId.trim(), filePath.trim());
      }
    } catch (error) {
      console.warn("[releases] could not read downloaded_tracks.txt:", error);
    }
    return history;
  }

  /** Recompute every release/track download flag from disk and history. */
  refreshDownloadedStatus(save = true): ReleaseFeed {
    const history = this.readDownloadedHistory();
    const libraryTracks = this.library.getTracks();
    const libraryIndex = new Map<string, TrackRecord[]>();

    for (const track of libraryTracks) {
      const key = titleKey(track.title);
      if (!key) continue;
      for (const artist of artistKeys(track.artist)) {
        const composite = `${artist}\u0000${key}`;
        const list = libraryIndex.get(composite) ?? [];
        list.push(track);
        libraryIndex.set(composite, list);
      }
    }

    const findLibraryTrack = (
      title: string,
      artist: string,
    ): TrackRecord | undefined => {
      const key = titleKey(title);
      if (!key) return undefined;
      for (const artistName of artistKeys(artist)) {
        const matches = libraryIndex.get(`${artistName}\u0000${key}`);
        if (matches && matches.length > 0) return matches[0];
      }
      return undefined;
    };

    for (const release of this.data.releases) {
      for (const track of release.tracks) {
        const historyPath = history.get(track.id) ?? null;
        const local = findLibraryTrack(track.title, track.artist);
        track.isDownloaded = Boolean(historyPath || local);
        track.filePath = historyPath ?? local?.path ?? null;
      }
      release.isDownloaded =
        release.tracks.length > 0 &&
        release.tracks.every((track) => track.isDownloaded);
    }

    if (save) this.save();
    return this.getFeed();
  }

  private webClient(deps: SpotifyWebDeps): SpotifyWebClient {
    if (!this.web) this.web = new SpotifyWebClient(deps);
    return this.web;
  }

  private async loadArtistReleases(
    web: SpotifyWebClient,
    artist: FollowedArtist,
    existing: Map<string, ReleaseRecord>,
    warnings: string[],
    now: number,
  ): Promise<ReleaseRecord[]> {
    const discography = await web.artistReleases(
      artist.id,
      DISCOGRAPHY_LIMIT,
    );
    const releases = recentArtistReleases(discography, now);
    const records: ReleaseRecord[] = [];

    for (const release of releases) {
      const cached = existing.get(release.id);
      let tracks: ReleaseTrack[] =
        cached && cached.tracks.length > 0
          ? cached.tracks.map((track) => ({ ...track }))
          : [];

      if (tracks.length === 0) {
        try {
          const fetched = await web.albumTracks(release.id, artist.name);
          tracks = fetched.map((track) => trackFromWeb(track, artist.name));
        } catch (error) {
          warnings.push(
            `${artist.name} · ${release.title}: ${errorMessage(error)}`,
          );
          tracks = [];
        }
      }

      records.push({
        id: release.id,
        title: release.title,
        artist: releaseArtistFromTracks(
          tracks,
          cached?.artist?.trim() || artist.name,
        ),
        artistId: artist.id,
        artistUrl: `https://open.spotify.com/artist/${artist.id}`,
        releaseDate: release.releaseDate,
        releaseDatePrecision: release.releaseDatePrecision,
        coverUrl: release.coverUrl ?? cached?.coverUrl ?? null,
        spotifyUrl: release.spotifyUrl,
        previewUrl:
          cached?.previewUrl ??
          tracks.find((track) => track.previewUrl)?.previewUrl ??
          null,
        type: releaseTypeFromWeb(release.type),
        tracks,
        isDownloaded:
          tracks.length > 0 && tracks.every((track) => track.isDownloaded),
      });
    }

    return records;
  }

  /**
   * Resolve the authoritative follow list. The desktop collection is preferred
   * because the app's web-player cookies may belong to a different Spotify
   * account. If there is no desktop cache, fall back to the signed-in web
   * account's follows.
   */
  private async spotifyFollows(
    web: SpotifyWebClient,
    warnings: string[],
  ): Promise<FollowedArtist[]> {
    const cachedById = new Map(
      this.data.artists.map((artist) => [artist.id, artist]),
    );
    const desktop = readSpotifyDesktopFollowedArtists();
    if (desktop) {
      return desktop.artists.map((artist) => {
        const cached = cachedById.get(artist.id);
        return {
          id: artist.id,
          name: artist.name || cached?.name || artist.id,
          localName: cached?.localName ?? (artist.name || null),
          imageUrl: cached?.imageUrl ?? null,
          followedAt: cached?.followedAt ?? Date.now(),
          manual: false,
          source: "spotify" as const,
        };
      });
    }

    warnings.push(
      "Spotify desktop collection not found; using the signed-in web account's followed artists.",
    );
    try {
      const follows = await web.following();
      return follows.map((artist) => {
        const cached = cachedById.get(artist.id);
        return {
          id: artist.id,
          name: artist.name || cached?.name || artist.id,
          localName: cached?.localName ?? (artist.name || null),
          imageUrl: artist.imageUrl ?? cached?.imageUrl ?? null,
          followedAt: cached?.followedAt ?? Date.now(),
          manual: false,
          source: "spotify" as const,
        };
      });
    } catch (error) {
      warnings.push(
        `Could not load Spotify followed artists: ${errorMessage(error)}`,
      );
      return [];
    }
  }

  async sync(
    deps: SpotifyWebDeps,
    library: LibraryStore,
  ): Promise<ReleaseFeed> {
    const { spDc, spKey } = await spotifyCredentials(deps, library);
    const web = this.webClient(deps);
    await web.configure(spDc, spKey);

    const now = Date.now();
    const warnings: string[] = [];
    const sourceArtists = await this.spotifyFollows(web, warnings);

    const byId = new Map<string, FollowedArtist>();
    for (const artist of sourceArtists) byId.set(artist.id, artist);
    // Manual follows always win over source duplicates.
    for (const artist of this.data.artists) {
      if (!artist.manual && artist.source !== "manual") continue;
      byId.set(artist.id, {
        ...artist,
        manual: true,
        source: "manual",
      });
    }

    const artists = [...byId.values()];
    if (artists.length === 0) {
      warnings.push(
        "No Spotify followed artists found. Follow artists in Spotify, then sync again.",
      );
    }

    let cursor = 0;
    const existingReleases = new Map(
      this.data.releases.map((release) => [release.id, release]),
    );
    const collected: ReleaseRecord[] = [];

    const releaseWorker = async (): Promise<void> => {
      while (cursor < artists.length) {
        const index = cursor;
        cursor += 1;
        const artist = artists[index];
        try {
          const releases = await this.loadArtistReleases(
            web,
            artist,
            existingReleases,
            warnings,
            now,
          );
          collected.push(...releases);
        } catch (error) {
          warnings.push(`${artist.name}: ${errorMessage(error)}`);
          for (const cached of this.data.releases) {
            if (cached.artistId === artist.id) collected.push(cached);
          }
        }
      }
    };

    await Promise.all(
      Array.from(
        { length: Math.min(SYNC_CONCURRENCY, Math.max(1, artists.length)) },
        () => releaseWorker(),
      ),
    );

    const deduped = new Map<string, ReleaseRecord>();
    for (const release of collected) deduped.set(release.id, release);

    this.data = {
      version: 1,
      artists: artists.sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      ),
      releases: sortReleases([...deduped.values()]),
      lastSyncedAt: Date.now(),
      lastSyncWarnings: warnings.slice(0, 8),
    };
    this.save();
    return this.refreshDownloadedStatus();
  }

  async setFollow(
    deps: SpotifyWebDeps,
    library: LibraryStore,
    payload: { name?: unknown; following?: unknown },
  ): Promise<ReleaseFeed> {
    const name =
      typeof payload.name === "string" ? payload.name.trim() : "";
    const following = Boolean(payload.following);
    if (!name) throw new Error("Artist name is required");

    const { spDc, spKey } = await spotifyCredentials(deps, library);
    const web = this.webClient(deps);
    await web.configure(spDc, spKey);

    const key = normalizeName(name);
    const existing = this.data.artists.find(
      (artist) =>
        normalizeName(artist.localName ?? artist.name) === key ||
        normalizeName(artist.name) === key,
    );

    if (following) {
      if (existing) {
        try {
          await web.setArtistFollow(existing.id, true);
        } catch (error) {
          throw new Error(
            `Could not follow on Spotify: ${errorMessage(error)}`,
          );
        }
        this.data.artists = this.data.artists.map((artist) =>
          artist.id === existing.id
            ? {
                ...artist,
                manual: true,
                source: "manual" as const,
              }
            : artist,
        );
        this.save();
        return this.refreshDownloadedStatus();
      }

      const candidates = await web.searchArtists(name, SEARCH_LIMIT);
      const found =
        candidates.find(
          (artist) => normalizeName(artist.name) === key,
        ) ??
        candidates.find((artist) => {
          const candidate = normalizeName(artist.name);
          return candidate.includes(key) || key.includes(candidate);
        }) ??
        null;
      if (!found) {
        throw new Error(`Spotify artist not found for "${name}".`);
      }

      try {
        await web.setArtistFollow(found.id, true);
      } catch (error) {
        throw new Error(
          `Could not follow on Spotify: ${errorMessage(error)}`,
        );
      }

      const artist: FollowedArtist = {
        id: found.id,
        name: found.name,
        localName: name,
        imageUrl: found.imageUrl,
        followedAt: Date.now(),
        manual: true,
        source: "manual",
      };
      this.data.artists = [
        ...this.data.artists.filter((item) => item.id !== artist.id),
        artist,
      ];

      const warnings: string[] = [];
      try {
        const existingReleases = new Map(
          this.data.releases.map((release) => [release.id, release]),
        );
        const releases = await this.loadArtistReleases(
          web,
          artist,
          existingReleases,
          warnings,
          Date.now(),
        );
        const keep = this.data.releases.filter(
          (release) => release.artistId !== artist.id,
        );
        this.data.releases = sortReleases([...keep, ...releases]);
      } catch (error) {
        warnings.push(`${artist.name}: ${errorMessage(error)}`);
      }
      this.data.lastSyncWarnings = warnings.slice(0, 8);
      this.save();
      return this.refreshDownloadedStatus();
    }

    if (!existing) return this.getFeed();
    if (!existing.manual && existing.source === "spotify") {
      throw new Error(
        "This artist comes from your Spotify account follows. Unfollow them in Spotify to remove them from New Releases.",
      );
    }

    try {
      await web.setArtistFollow(existing.id, false);
    } catch (error) {
      throw new Error(
        `Could not unfollow on Spotify: ${errorMessage(error)}`,
      );
    }

    this.data.artists = this.data.artists.filter(
      (artist) => artist.id !== existing.id,
    );
    this.data.releases = this.data.releases.filter(
      (release) => release.artistId !== existing.id,
    );
    this.save();
    return this.refreshDownloadedStatus();
  }

  dispose(): void {
    this.web?.dispose();
    this.web = null;
  }
}
