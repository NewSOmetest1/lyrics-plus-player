import { getSpotifyAccessToken, readSpotifyCookies } from "./spotify-auth.cjs";
import { SpotifyWebClient, type SpotifyWebDeps } from "./spotify-web";
import type { ArtistCacheStore } from "./artist-cache";
import type { LibraryStore } from "./store";
import type {
  SpotifyAlbumCatalog,
  SpotifyAlbumSummary,
  SpotifyArtistCatalog,
  SpotifyArtistSummary,
  SpotifyCatalogTrack,
  SpotifySearchCatalog,
} from "./types";

const WEB_API = "https://api.spotify.com/v1";
const REQUEST_TIMEOUT_MS = 12_000;
const CACHE_MS = 10 * 60 * 1000;
const SEARCH_HASH =
  "dd78eaff943eba629ed70ee25517b9cea0dcaa41193e2592ae2727660b21892c";
const ASSISTED_SEARCH_HASH =
  "f78953bf9207d73493c27284103f5aeb6e728876d5793851bf79bc706127ff70";
const ARTIST_OVERVIEW_HASH =
  "eafb1620d783ece118e72fbfede2b0064483e029d3c1aafafa1c2de0e25a89e7";
const ALBUM_HASH =
  "0b6ce3511e1b02e4a40fa95440f992acbe85080eb308af9194322d708fc1914f";

interface ImageSource {
  url?: string;
  width?: number;
  height?: number;
}

interface WebArtist {
  id?: string;
  name?: string;
  genres?: string[];
  followers?: { total?: number };
  popularity?: number;
  images?: ImageSource[];
}

interface WebAlbum {
  id?: string;
  name?: string;
  album_type?: string;
  artists?: Array<{ name?: string }>;
  release_date?: string;
  release_date_precision?: string;
  images?: ImageSource[];
  total_tracks?: number;
}

interface WebTrack {
  id?: string;
  name?: string;
  artists?: Array<{ name?: string }>;
  album?: {
    id?: string;
    name?: string;
    images?: ImageSource[];
  };
  duration_ms?: number;
  track_number?: number;
}

interface WebSavedSearch {
  artists?: { items?: WebArtist[] };
  albums?: { items?: WebAlbum[] };
  tracks?: { items?: WebTrack[] };
}

interface WebAlbumTracksPage {
  items?: WebTrack[];
  total?: number;
  offset?: number;
  limit?: number;
}

interface WebAlbumDetails extends WebAlbum {
  tracks?: WebAlbumTracksPage;
}

interface PartnerEntity {
  __typename?: string;
  uri?: string;
  name?: string;
  type?: string;
  id?: string;
  profile?: {
    name?: string;
    genres?: { items?: Array<{ name?: string }> };
  };
  genres?: { items?: Array<{ name?: string }> };
  visuals?: { avatarImage?: { sources?: ImageSource[] } };
  stats?: { followers?: number; monthlyListeners?: number };
  artists?: {
    items?: Array<{
      uri?: string;
      profile?: { name?: string };
    }>;
  };
  albumOfTrack?: {
    uri?: string;
    name?: string;
    coverArt?: { sources?: ImageSource[] };
  };
  coverArt?: { sources?: ImageSource[] };
  date?: { isoString?: string; precision?: string; year?: number };
  tracks?: {
    totalCount?: number;
    items?: Array<{ track?: PartnerEntity }>;
  };
  tracksV2?: {
    totalCount?: number;
    items?: Array<{ track?: PartnerEntity }>;
  };
  duration?: { totalMilliseconds?: number };
  trackNumber?: number;
  discography?: {
    topTracks?: { items?: Array<{ track?: PartnerEntity }> };
    albums?: { items?: Array<{ releases?: { items?: PartnerEntity[] } }> };
    singles?: { items?: Array<{ releases?: { items?: PartnerEntity[] } }> };
  };
}

interface PartnerWrapper {
  __typename?: string;
  data?: PartnerEntity;
  item?: PartnerWrapper;
}

interface PartnerSearchData {
  searchV2?: {
    query?: string;
    topResultsV2?: { itemsV2?: PartnerWrapper[]; items?: PartnerWrapper[] };
    artists?: { items?: PartnerWrapper[] };
    albumsV2?: { items?: PartnerWrapper[] };
    tracksV2?: { items?: PartnerWrapper[] };
  };
}

interface PartnerArtistData {
  artistUnion?: PartnerEntity;
}

interface PartnerAlbumData {
  albumUnion?: PartnerEntity;
}

interface Credentials {
  spDc: string;
  spKey: string;
}

interface Cached<T> {
  at: number;
  value: T;
}

function pickImage(images: ImageSource[] | undefined): string | null {
  if (!images || images.length === 0) return null;
  const sorted = [...images].sort(
    (a, b) =>
      (b.width ?? 0) * (b.height ?? 0) -
      (a.width ?? 0) * (a.height ?? 0),
  );
  return sorted.find((image) => image.url)?.url ?? null;
}

function idFromUri(uri: string | undefined, kind: string): string | null {
  if (!uri) return null;
  const match = new RegExp(`^spotify:${kind}:([A-Za-z0-9]+)$`).exec(uri);
  return match?.[1] ?? null;
}

function normalizeWebArtist(artist: WebArtist): SpotifyArtistSummary | null {
  const id = artist.id?.trim();
  const name = artist.name?.trim();
  if (!id || !name) return null;
  return {
    id,
    name,
    imageUrl: pickImage(artist.images),
    genres: Array.isArray(artist.genres) ? artist.genres : [],
    followers: artist.followers?.total ?? 0,
    monthlyListeners: 0,
    popularity: artist.popularity ?? 0,
    spotifyUrl: `https://open.spotify.com/artist/${id}`,
  };
}

function normalizeWebAlbum(album: WebAlbum): SpotifyAlbumSummary | null {
  const id = album.id?.trim();
  const title = album.name?.trim();
  if (!id || !title) return null;
  const artists = (album.artists ?? [])
    .map((artist) => artist.name?.trim())
    .filter((name): name is string => Boolean(name));
  const precision =
    album.release_date_precision === "year" ||
    album.release_date_precision === "month"
      ? album.release_date_precision
      : "day";
  return {
    id,
    title,
    artist: artists.join(", "),
    artists,
    releaseDate: album.release_date ?? "",
    releaseDatePrecision: precision,
    coverUrl: pickImage(album.images),
    spotifyUrl: `https://open.spotify.com/album/${id}`,
    totalTracks: album.total_tracks ?? 0,
    type: (album.album_type ?? "album").toUpperCase(),
  };
}

function normalizeWebTrack(
  track: WebTrack,
  fallbackAlbum?: { id?: string; name?: string; coverUrl?: string | null },
): SpotifyCatalogTrack | null {
  const id = track.id?.trim();
  const title = track.name?.trim();
  if (!id || !title) return null;
  const artists = (track.artists ?? [])
    .map((artist) => artist.name?.trim())
    .filter((name): name is string => Boolean(name));
  const albumId = track.album?.id?.trim() ?? fallbackAlbum?.id ?? null;
  return {
    id,
    title,
    artist: artists.join(", "),
    artists,
    album: track.album?.name?.trim() ?? fallbackAlbum?.name ?? "",
    albumId,
    coverUrl:
      pickImage(track.album?.images) ?? fallbackAlbum?.coverUrl ?? null,
    durationMs: track.duration_ms ?? 0,
    trackNumber: track.track_number ?? 0,
    spotifyUrl: `https://open.spotify.com/track/${id}`,
  };
}

function normalizePartnerArtists(
  entity: PartnerEntity | undefined,
): string[] {
  return (entity?.artists?.items ?? [])
    .map((artist) => artist.profile?.name?.trim())
    .filter((name): name is string => Boolean(name));
}

function normalizePartnerArtist(
  entity: PartnerEntity | undefined,
): SpotifyArtistSummary | null {
  const id = idFromUri(entity?.uri, "artist") ?? entity?.id?.trim() ?? null;
  const name = entity?.profile?.name?.trim() ?? entity?.name?.trim();
  if (!id || !name) return null;
  const genres =
    entity?.profile?.genres?.items ?? entity?.genres?.items ?? [];
  return {
    id,
    name,
    imageUrl: pickImage(entity?.visuals?.avatarImage?.sources),
    genres: genres
      .map((genre) => genre.name?.trim())
      .filter((genre): genre is string => Boolean(genre)),
    followers: entity?.stats?.followers ?? 0,
    monthlyListeners: entity?.stats?.monthlyListeners ?? 0,
    popularity: entity?.stats?.monthlyListeners ?? 0,
    spotifyUrl: `https://open.spotify.com/artist/${id}`,
  };
}

function normalizePartnerAlbum(
  entity: PartnerEntity | undefined,
): SpotifyAlbumSummary | null {
  const id = idFromUri(entity?.uri, "album") ?? entity?.id?.trim() ?? null;
  const title = entity?.name?.trim();
  if (!id || !title) return null;
  const artists = normalizePartnerArtists(entity);
  const iso = entity?.date?.isoString ?? "";
  const precision =
    entity?.date?.precision === "YEAR"
      ? "year"
      : entity?.date?.precision === "MONTH"
        ? "month"
        : "day";
  return {
    id,
    title,
    artist: artists.join(", "),
    artists,
    releaseDate: iso || (entity?.date?.year ? String(entity.date.year) : ""),
    releaseDatePrecision: precision,
    coverUrl: pickImage(entity?.coverArt?.sources),
    spotifyUrl: `https://open.spotify.com/album/${id}`,
    totalTracks:
      entity?.tracksV2?.totalCount ?? entity?.tracks?.totalCount ?? 0,
    type: (entity?.type ?? "ALBUM").toUpperCase(),
  };
}

function normalizePartnerTrack(
  entity: PartnerEntity | undefined,
): SpotifyCatalogTrack | null {
  const id = idFromUri(entity?.uri, "track");
  const title = entity?.name?.trim();
  if (!id || !title) return null;
  const artists = normalizePartnerArtists(entity);
  const albumId = idFromUri(entity?.albumOfTrack?.uri, "album");
  return {
    id,
    title,
    artist: artists.join(", "),
    artists,
    album: entity?.albumOfTrack?.name?.trim() ?? "",
    albumId,
    coverUrl: pickImage(entity?.albumOfTrack?.coverArt?.sources),
    durationMs: entity?.duration?.totalMilliseconds ?? 0,
    trackNumber: entity?.trackNumber ?? 0,
    spotifyUrl: `https://open.spotify.com/track/${id}`,
  };
}

function unwrapPartnerEntity(wrapper: PartnerWrapper | undefined): PartnerEntity | undefined {
  if (!wrapper) return undefined;
  if (wrapper.data) return wrapper.data;
  if (wrapper.item) return unwrapPartnerEntity(wrapper.item);
  return wrapper as PartnerEntity;
}

function releaseArray(
  groups: Array<{ releases?: { items?: PartnerEntity[] } }> | undefined,
): SpotifyAlbumSummary[] {
  const albums: SpotifyAlbumSummary[] = [];
  for (const group of groups ?? []) {
    for (const release of group.releases?.items ?? []) {
      const album = normalizePartnerAlbum(release);
      if (album) albums.push(album);
    }
  }
  return albums;
}

function yearOf(value: string): number {
  const year = Number.parseInt(value.slice(0, 4), 10);
  return Number.isFinite(year) ? year : 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function fetchJson<T>(url: string, init: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `Spotify Web API ${response.status}${text ? `: ${text.slice(0, 160)}` : ""}`,
      );
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Spotify catalog bridge for global search and the hybrid artist page.
 *
 * The public Web API is the primary source required by the feature spec. Web
 * player tokens are frequently rate limited, so every read also has a
 * first-party partner GraphQL fallback and short in-memory cache.
 */
export class SpotifyCatalogService {
  private partnerClient: SpotifyWebClient | null = null;
  private partnerKey = "";
  private readonly cache = new Map<string, Cached<unknown>>();

  constructor(
    private readonly deps: SpotifyWebDeps,
    private readonly store: LibraryStore,
    private readonly artistCache?: ArtistCacheStore,
  ) {}

  private rememberArtists(artists: Array<SpotifyArtistSummary | null>): void {
    for (const artist of artists) {
      this.artistCache?.remember(artist);
    }
  }

  private cached<T>(key: string): T | null {
    const entry = this.cache.get(key) as Cached<T> | undefined;
    if (!entry) return null;
    if (Date.now() - entry.at > CACHE_MS) {
      this.cache.delete(key);
      return null;
    }
    return entry.value;
  }

  private remember<T>(key: string, value: T): T {
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  private async credentials(): Promise<Credentials> {
    const cookies = await readSpotifyCookies(this.deps.session.defaultSession);
    const spDc =
      cookies.spDc || this.store.getSetting("spotify_sp_dc")?.trim() || "";
    const spKey =
      cookies.spKey || this.store.getSetting("spotify_sp_key")?.trim() || "";
    if (!spDc || !spKey) {
      throw new Error(
        "Spotify is not connected. Open Settings → Providers and sign in first.",
      );
    }
    return { spDc, spKey };
  }

  private async web<T>(path: string): Promise<T> {
    const credentials = await this.credentials();
    const token = await getSpotifyAccessToken(
      this.deps,
      credentials.spDc,
      credentials.spKey,
    );
    if (!token.token) {
      throw new Error(token.message || "Spotify access token is unavailable.");
    }
    return fetchJson<T>(`${WEB_API}${path}`, {
      headers: {
        Authorization: `Bearer ${token.token}`,
        Accept: "application/json",
      },
    });
  }

  private async partner(): Promise<SpotifyWebClient> {
    const credentials = await this.credentials();
    const key = `${credentials.spDc}\u0000${credentials.spKey}`;
    if (!this.partnerClient || this.partnerKey !== key) {
      this.partnerClient?.dispose();
      this.partnerClient = new SpotifyWebClient(this.deps);
      this.partnerKey = key;
    }
    await this.partnerClient.configure(credentials.spDc, credentials.spKey);
    return this.partnerClient;
  }

  private async searchPartner(
    term: string,
    warnings: string[],
  ): Promise<SpotifySearchCatalog | null> {
    const client = await this.partner();

    const collect = (data: PartnerSearchData) => {
      const artists: SpotifyArtistSummary[] = [];
      const albums: SpotifyAlbumSummary[] = [];
      const tracks: SpotifyCatalogTrack[] = [];
      const albumUris: string[] = [];

      const add = (entity: PartnerEntity | undefined) => {
        if (!entity) return;
        const type = entity.__typename;
        if (type === "Artist") {
          const artist = normalizePartnerArtist(entity);
          if (artist && !artists.some((item) => item.id === artist.id)) {
            artists.push(artist);
          }
          return;
        }
        if (type === "Album") {
          const album = normalizePartnerAlbum(entity);
          if (album && !albums.some((item) => item.id === album.id)) {
            albums.push(album);
          }
          return;
        }
        if (type === "Track") {
          const track = normalizePartnerTrack(entity);
          if (track && !tracks.some((item) => item.id === track.id)) {
            tracks.push(track);
          }
        }
      };

      const search = data.searchV2;
      const top = search?.topResultsV2?.itemsV2 ?? [];
      for (const wrapper of top) add(unwrapPartnerEntity(wrapper));
      for (const wrapper of search?.artists?.items ?? []) {
        add(unwrapPartnerEntity(wrapper));
      }
      for (const wrapper of search?.albumsV2?.items ?? []) {
        const entity = unwrapPartnerEntity(wrapper);
        add(entity);
        if (entity?.uri && !entity.name) albumUris.push(entity.uri);
      }
      for (const wrapper of search?.tracksV2?.items ?? []) {
        add(unwrapPartnerEntity(wrapper));
      }

      return { artists, albums, tracks, albumUris };
    };

    const finish = (
      values: ReturnType<typeof collect>,
    ): SpotifySearchCatalog | null => {
      const { artists, albums, tracks } = values;
      if (artists.length === 0 && albums.length === 0 && tracks.length === 0) {
        return null;
      }
      return {
        query: term,
        artists: artists.slice(0, 12),
        albums: albums.slice(0, 12),
        tracks: tracks.slice(0, 12),
        warnings,
      };
    };

    type Collected = ReturnType<typeof collect>;
    const merge = (target: Collected, source: Collected) => {
      for (const artist of source.artists) {
        if (!target.artists.some((item) => item.id === artist.id)) {
          target.artists.push(artist);
        }
      }
      for (const album of source.albums) {
        if (!target.albums.some((item) => item.id === album.id)) {
          target.albums.push(album);
        }
      }
      for (const track of source.tracks) {
        if (!target.tracks.some((item) => item.id === track.id)) {
          target.tracks.push(track);
        }
      }
      target.albumUris.push(...source.albumUris);
    };

    const [topResult, assistedResult] = await Promise.allSettled([
      client.graphql<PartnerSearchData>(
        "searchTopResultsList",
        {
          query: term,
          limit: 24,
          offset: 0,
          numberOfTopResults: 24,
          includeArtistHasConcertsField: false,
          includeAudiobooks: false,
          includeAuthors: false,
          includePreReleases: false,
          includeAlbumPreReleases: false,
          includeEpisodeContentRatingsV2: false,
          isPrefix: null,
          sectionFilters: ["GENERIC"],
        },
        SEARCH_HASH,
      ),
      client.graphql<PartnerSearchData>(
        "assistedCurationSearch",
        { term, limit: 24, numberOfTopResults: 24 },
        ASSISTED_SEARCH_HASH,
      ),
    ]);

    const values: Collected = {
      artists: [],
      albums: [],
      tracks: [],
      albumUris: [],
    };
    if (topResult.status === "fulfilled") {
      merge(values, collect(topResult.value));
    }
    if (assistedResult.status === "fulfilled") {
      const assisted = collect(assistedResult.value);
      merge(values, assisted);
      // The assisted query returns only URIs for its sections. Resolve a few
      // albums so the search page can show real download cards.
      const knownAlbums = new Set(values.albums.map((album) => album.id));
      const pendingAlbums = assisted.albumUris
        .map((uri) => /^spotify:album:([A-Za-z0-9]+)$/.exec(uri)?.[1])
        .filter(
          (id): id is string => Boolean(id) && !knownAlbums.has(id as string),
        )
        .slice(0, 8);
      if (pendingAlbums.length > 0) {
        const resolved = await Promise.allSettled(
          pendingAlbums.map((id) =>
            client.graphql<PartnerAlbumData>(
              "getAlbum",
              {
                uri: `spotify:album:${id}`,
                locale: "",
                offset: 0,
                limit: 50,
              },
              ALBUM_HASH,
            ),
          ),
        );
        for (const entry of resolved) {
          if (entry.status !== "fulfilled") continue;
          const album = normalizePartnerAlbum(entry.value.albumUnion);
          if (album && !knownAlbums.has(album.id)) {
            knownAlbums.add(album.id);
            values.albums.push(album);
          }
        }
      }
    }

    if (
      topResult.status === "rejected" &&
      assistedResult.status === "rejected"
    ) {
      warnings.push(
        `Spotify GraphQL search failed: ${errorMessage(
          topResult.reason ?? assistedResult.reason,
        )}`,
      );
    }

    if (values.artists.length === 0 && values.tracks.length === 0) {
      // Older partner responses only expose the dedicated artist section.
      try {
        const fallbackArtists = await client.searchArtists(term, 12);
        for (const artist of fallbackArtists) {
          values.artists.push({
            ...artist,
            genres: [],
            followers: 0,
            monthlyListeners: 0,
            popularity: 0,
            spotifyUrl: `https://open.spotify.com/artist/${artist.id}`,
          });
        }
      } catch {
        // Search has already reported a failure when both queries failed.
      }
    }

    return finish(values);
  }

  async search(rawQuery: string): Promise<SpotifySearchCatalog> {
    const term = rawQuery.trim();
    if (!term) {
      return {
        query: "",
        artists: [],
        albums: [],
        tracks: [],
        warnings: [],
      };
    }
    const cacheKey = `search:${term.toLocaleLowerCase()}`;
    const cached = this.cached<SpotifySearchCatalog>(cacheKey);
    if (cached) return cached;

    const warnings: string[] = [];
    try {
      const data = await this.web<WebSavedSearch>(
        `/search?q=${encodeURIComponent(term)}&type=artist,album,track&limit=12`,
      );
      const result: SpotifySearchCatalog = {
        query: term,
        artists: (data.artists?.items ?? [])
          .map(normalizeWebArtist)
          .filter((artist): artist is SpotifyArtistSummary => Boolean(artist)),
        albums: (data.albums?.items ?? [])
          .map(normalizeWebAlbum)
          .filter((album): album is SpotifyAlbumSummary => Boolean(album)),
        tracks: (data.tracks?.items ?? [])
          .map((track) => normalizeWebTrack(track))
          .filter((track): track is SpotifyCatalogTrack => Boolean(track)),
        warnings,
      };
      this.rememberArtists(result.artists);
      return this.remember(cacheKey, result);
    } catch (error) {
      warnings.push(errorMessage(error));
    }

    const fallback = await this.searchPartner(term, warnings);
    if (fallback) {
      // The public API is frequently rate limited for web-player tokens. The
      // partner fallback is expected, so do not surface that transient error.
      const visible = fallback.warnings.filter(
        (warning) =>
          !/^Spotify Web API 429/.test(warning) &&
          !/API rate limit exceeded/i.test(warning),
      );
      this.rememberArtists(fallback.artists);
      return this.remember(cacheKey, { ...fallback, warnings: visible });
    }
    throw new Error(warnings.join(" ") || "Spotify search is unavailable.");
  }

  private partnerOverview(
    data: PartnerArtistData,
  ): {
    artist: SpotifyArtistSummary | null;
    topTracks: SpotifyCatalogTrack[];
    albums: SpotifyAlbumSummary[];
  } {
    const entity = data.artistUnion;
    const artist = normalizePartnerArtist(entity);
    const topTracks = (entity?.discography?.topTracks?.items ?? [])
      .map((item) => normalizePartnerTrack(item.track))
      .filter((track): track is SpotifyCatalogTrack => Boolean(track));
    const albums = [
      ...releaseArray(entity?.discography?.albums?.items),
      ...releaseArray(entity?.discography?.singles?.items),
    ];
    const unique = new Map<string, SpotifyAlbumSummary>();
    for (const album of albums) unique.set(album.id, album);
    return {
      artist,
      topTracks,
      albums: [...unique.values()].sort(
        (a, b) => yearOf(b.releaseDate) - yearOf(a.releaseDate),
      ),
    };
  }

  async artist(
    rawArtistId: string,
    fallbackName?: string,
  ): Promise<SpotifyArtistCatalog> {
    const artistId = rawArtistId.trim();
    if (!artistId && !fallbackName?.trim()) {
      throw new Error("An artist id or name is required.");
    }
    const cacheKey = artistId
      ? `artist:${artistId}`
      : `artist:name:${fallbackName?.trim().toLocaleLowerCase()}`;
    const cached = this.cached<SpotifyArtistCatalog>(cacheKey);
    if (cached) return cached;

    const warnings: string[] = [];
    let profile: SpotifyArtistSummary | null = null;
    let topTracks: SpotifyCatalogTrack[] = [];
    let albums: SpotifyAlbumSummary[] = [];

    if (artistId) {
      const [profileResult, topResult, albumsResult] = await Promise.allSettled([
        this.web<WebArtist>(`/artists/${artistId}`),
        this.web<{ tracks?: WebTrack[] }>(
          `/artists/${artistId}/top-tracks?market=from_token`,
        ),
        this.web<{ items?: WebAlbum[] }>(
          `/artists/${artistId}/albums?include_groups=album,single&limit=50&market=from_token`,
        ),
      ]);

      if (profileResult.status === "fulfilled") {
        profile = normalizeWebArtist(profileResult.value);
      } else {
        warnings.push(errorMessage(profileResult.reason));
      }
      if (topResult.status === "fulfilled") {
        topTracks = (topResult.value.tracks ?? [])
          .map((track) => normalizeWebTrack(track))
          .filter((track): track is SpotifyCatalogTrack => Boolean(track))
          .slice(0, 10);
      }
      if (albumsResult.status === "fulfilled") {
        albums = (albumsResult.value.items ?? [])
          .map(normalizeWebAlbum)
          .filter((album): album is SpotifyAlbumSummary => Boolean(album));
      }
    }

    // The public API is usually 429 for web-player tokens. Reuse the web
    // player's own artist overview query for profile, top tracks and releases.
    if (artistId && (!profile || topTracks.length === 0 || albums.length === 0)) {
      try {
        const client = await this.partner();
        const data = await client.graphql<PartnerArtistData>(
          "queryArtistOverview",
          {
            uri: `spotify:artist:${artistId}`,
            locale: "",
            preReleaseV2: true,
            includeMusicVideoPreviews: false,
          },
          ARTIST_OVERVIEW_HASH,
        );
        const overview = this.partnerOverview(data);
        if (!profile) profile = overview.artist;
        if (topTracks.length === 0) topTracks = overview.topTracks.slice(0, 10);
        if (albums.length === 0) albums = overview.albums;
      } catch (error) {
        warnings.push(`Spotify GraphQL artist failed: ${errorMessage(error)}`);
      }
    }

    if (!profile && fallbackName?.trim()) {
      try {
        const artistSearch = await this.search(fallbackName);
        profile =
          artistSearch.artists.find(
            (artist) =>
              artist.name.toLocaleLowerCase() ===
              fallbackName.trim().toLocaleLowerCase(),
          ) ??
          artistSearch.artists[0] ??
          null;
      } catch {
        // Search already reports its own failure below.
      }
    }

    if (!profile) {
      throw new Error(
        warnings.join(" ") || "Spotify did not return this artist.",
      );
    }

    let latestRelease: SpotifyAlbumSummary | null = null;
    if (artistId) {
      try {
        // The overview only gives a year for many releases, which is not
        // enough to identify the actual newest one. Spotify's DATE_DESC
        // discography query returns the true latest release.
        const client = await this.partner();
        const [newest] = await client.artistReleases(artistId, 1);
        if (newest) {
          latestRelease = {
            id: newest.id,
            title: newest.title,
            artist: profile.name,
            artists: [profile.name],
            releaseDate: newest.releaseDate,
            releaseDatePrecision: newest.releaseDatePrecision,
            coverUrl: newest.coverUrl,
            spotifyUrl: newest.spotifyUrl,
            totalTracks: newest.totalTracks,
            type: newest.type.toUpperCase(),
          };
        }
      } catch (error) {
        warnings.push(
          `Spotify GraphQL latest release failed: ${errorMessage(error)}`,
        );
      }
    }

    const uniqueTracks = new Map<string, SpotifyCatalogTrack>();
    for (const track of topTracks) {
      if (!uniqueTracks.has(track.id)) uniqueTracks.set(track.id, track);
    }
    const uniqueAlbums = new Map<string, SpotifyAlbumSummary>();
    for (const album of albums) {
      if (!uniqueAlbums.has(album.id)) uniqueAlbums.set(album.id, album);
    }
    if (latestRelease) {
      const existing = uniqueAlbums.get(latestRelease.id);
      uniqueAlbums.set(
        latestRelease.id,
        existing
          ? {
              ...existing,
              releaseDate: latestRelease.releaseDate,
              releaseDatePrecision: latestRelease.releaseDatePrecision,
            }
          : latestRelease,
      );
    }
    const albumList = [...uniqueAlbums.values()];
    if (latestRelease) {
      const index = albumList.findIndex(
        (album) => album.id === latestRelease?.id,
      );
      if (index > 0) {
        const [newest] = albumList.splice(index, 1);
        albumList.unshift(newest);
      }
    }

    const result: SpotifyArtistCatalog = {
      artist: profile,
      topTracks: [...uniqueTracks.values()].slice(0, 10),
      albums: albumList,
      latestRelease,
      warnings: [...new Set(warnings)],
    };
    this.artistCache?.remember(profile);
    return this.remember(cacheKey, result);
  }

  async album(
    rawAlbumId: string,
    fallback?: {
      artist?: string;
      album?: string;
      coverUrl?: string | null;
      releaseDate?: string;
      totalTracks?: number;
    },
  ): Promise<SpotifyAlbumCatalog> {
    const albumId = rawAlbumId.trim();
    if (!albumId) throw new Error("An album id is required.");
    const cacheKey = `album:${albumId}`;
    const cached = this.cached<SpotifyAlbumCatalog>(cacheKey);
    if (cached) return cached;

    const warnings: string[] = [];
    let album: SpotifyAlbumSummary | null = null;
    let tracks: SpotifyCatalogTrack[] = [];

    try {
      const data = await this.web<WebAlbumDetails>(`/albums/${albumId}`);
      album = normalizeWebAlbum(data);
      const webTracks = [...(data.tracks?.items ?? [])];
      const total = data.tracks?.total ?? album?.totalTracks ?? webTracks.length;
      const pageSize = data.tracks?.limit ?? 50;
      const baseOffset = data.tracks?.offset ?? 0;
      // The album endpoint returns the first 50 tracks only. Keep paging so
      // long albums still get a complete tracklist.
      while (pageSize > 0 && baseOffset + webTracks.length < total) {
        const offset = baseOffset + webTracks.length;
        const page = await this.web<WebAlbumTracksPage>(
          `/albums/${albumId}/tracks?limit=${pageSize}&offset=${offset}`,
        );
        const items = page.items ?? [];
        if (items.length === 0) break;
        webTracks.push(...items);
        if (items.length < pageSize) break;
      }
      tracks = webTracks
        .map((track) =>
          normalizeWebTrack(track, {
            id: albumId,
            name: album?.title ?? fallback?.album ?? "",
            coverUrl: album?.coverUrl ?? fallback?.coverUrl ?? null,
          }),
        )
        .filter((track): track is SpotifyCatalogTrack => Boolean(track));
    } catch (error) {
      warnings.push(errorMessage(error));
    }

    if (!album || tracks.length === 0) {
      try {
        const client = await this.partner();
        const data = await client.graphql<PartnerAlbumData>(
          "getAlbum",
          {
            uri: `spotify:album:${albumId}`,
            locale: "",
            offset: 0,
            limit: 300,
          },
          ALBUM_HASH,
        );
        const entity = data.albumUnion;
        album = album ?? normalizePartnerAlbum(entity);
        if (tracks.length === 0) {
          const albumTitle =
            album?.title ?? fallback?.album ?? entity?.name?.trim() ?? "";
          const albumArtist =
            album?.artist ?? fallback?.artist ?? "";
          const coverUrl =
            album?.coverUrl ?? fallback?.coverUrl ?? null;
          tracks = (entity?.tracksV2?.items ?? entity?.tracks?.items ?? [])
            .map((item) => normalizePartnerTrack(item.track))
            .filter((track): track is SpotifyCatalogTrack => Boolean(track))
            .map((track) => ({
              ...track,
              artist: track.artist || albumArtist,
              artists:
                track.artists.length > 0
                  ? track.artists
                  : albumArtist
                    ? [albumArtist]
                    : [],
              album: track.album || albumTitle,
              albumId: track.albumId ?? albumId,
              coverUrl: track.coverUrl ?? coverUrl,
            }));
        }
      } catch (error) {
        warnings.push(`Spotify GraphQL album failed: ${errorMessage(error)}`);
      }
    }

    if (tracks.length === 0) {
      try {
        tracks = await this.albumTracks(albumId, {
          artist: fallback?.artist ?? album?.artist ?? "",
          album: fallback?.album ?? album?.title ?? "",
          coverUrl: fallback?.coverUrl ?? album?.coverUrl ?? null,
        });
      } catch (error) {
        warnings.push(errorMessage(error));
      }
    }

    if (!album) {
      const title = fallback?.album?.trim() ?? "";
      const artist = fallback?.artist?.trim() ?? "";
      if (!title) {
        throw new Error(
          warnings.join(" ") || "Spotify did not return this album.",
        );
      }
      album = {
        id: albumId,
        title,
        artist,
        artists: artist ? [artist] : [],
        releaseDate: fallback?.releaseDate ?? "",
        releaseDatePrecision: "year",
        coverUrl: fallback?.coverUrl ?? null,
        spotifyUrl: `https://open.spotify.com/album/${albumId}`,
        totalTracks: fallback?.totalTracks ?? tracks.length,
        type: "ALBUM",
      };
    }

    const result: SpotifyAlbumCatalog = {
      album: {
        ...album,
        totalTracks: album.totalTracks || tracks.length,
        coverUrl: album.coverUrl ?? fallback?.coverUrl ?? null,
      },
      tracks,
      warnings: [...new Set(warnings)],
    };
    return this.remember(cacheKey, result);
  }

  async albumTracks(
    rawAlbumId: string,
    fallback?: { artist?: string; album?: string; coverUrl?: string | null },
  ): Promise<SpotifyCatalogTrack[]> {
    const albumId = rawAlbumId.trim();
    if (!albumId) throw new Error("An album id is required.");
    const cacheKey = `album-tracks:${albumId}`;
    const cached = this.cached<SpotifyCatalogTrack[]>(cacheKey);
    if (cached) return cached;

    const warnings: string[] = [];
    try {
      const data = await this.web<WebAlbumDetails>(`/albums/${albumId}`);
      const album = normalizeWebAlbum(data);
      const webTracks = [...(data.tracks?.items ?? [])];
      const total = data.tracks?.total ?? album?.totalTracks ?? webTracks.length;
      const pageSize = data.tracks?.limit ?? 50;
      const baseOffset = data.tracks?.offset ?? 0;
      while (pageSize > 0 && baseOffset + webTracks.length < total) {
        const offset = baseOffset + webTracks.length;
        const page = await this.web<WebAlbumTracksPage>(
          `/albums/${albumId}/tracks?limit=${pageSize}&offset=${offset}`,
        );
        const items = page.items ?? [];
        if (items.length === 0) break;
        webTracks.push(...items);
        if (items.length < pageSize) break;
      }
      const tracks = webTracks
        .map((track) =>
          normalizeWebTrack(track, {
            id: albumId,
            name: album?.title ?? fallback?.album ?? "",
            coverUrl: album?.coverUrl ?? fallback?.coverUrl ?? null,
          }),
        )
        .filter((track): track is SpotifyCatalogTrack => Boolean(track));
      if (tracks.length > 0) return this.remember(cacheKey, tracks);
    } catch (error) {
      warnings.push(errorMessage(error));
    }

    try {
      const client = await this.partner();
      const tracks = await client.albumTracks(
        albumId,
        fallback?.artist ?? "",
      );
      const normalized = tracks.map((track) => ({
        id: track.id,
        title: track.title,
        artist: track.artist,
        artists: track.artists,
        album: fallback?.album ?? "",
        albumId,
        coverUrl: fallback?.coverUrl ?? null,
        durationMs: track.durationMs,
        trackNumber: track.trackNumber,
        spotifyUrl: track.spotifyUrl,
      }));
      if (normalized.length > 0) {
        return this.remember(cacheKey, normalized);
      }
    } catch (error) {
      warnings.push(`Spotify GraphQL album failed: ${errorMessage(error)}`);
    }

    throw new Error(
      warnings.join(" ") || "Spotify did not return album tracks.",
    );
  }

  async resolveArtist(
    name: string,
  ): Promise<SpotifyArtistSummary | null> {
    const result = await this.search(name);
    const normalized = name.trim().toLocaleLowerCase();
    return (
      result.artists.find(
        (artist) => artist.name.trim().toLocaleLowerCase() === normalized,
      ) ??
      result.artists[0] ??
      null
    );
  }

  dispose(): void {
    this.partnerClient?.dispose();
    this.partnerClient = null;
    this.partnerKey = "";
    this.cache.clear();
  }
}
