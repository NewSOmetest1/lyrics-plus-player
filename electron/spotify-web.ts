import type {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  Session,
} from "electron";

const PARTNER_ENDPOINT =
  "https://api-partner.spotify.com/pathfinder/v2/query";
const PARTITION = "lyrics-plus-spotify-releases";
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const REQUEST_TIMEOUT_MS = 20_000;
const HEADER_TTL_MS = 20 * 60 * 1000;
const WARMUP_TIMEOUT_MS = 20_000;

const HASHES = {
  profileAttributes:
    "08ffb4730af3746e04a8301396f20875dbbce10c75243803091a9274eacc8ac0",
  queryArtistDiscographyAll:
    "5e07d323febb57b4a56a42abbf781490e58764aa45feb6e3dc0591564fc56599",
  queryAlbumTracks:
    "0b6ce3511e1b02e4a40fa95440f992acbe85080eb308af9194322d708fc1914f",
  searchArtists:
    "7bf95d754fdbe32c8b161fbbe54d1ae50974900df4dce4c8f1afcbcad153224d",
  library:
    "896ebcb47815681340860d121cb5d494e157e2a78d3950385cd54e0393c67148",
} as const;

export interface SpotifyWebDeps {
  BrowserWindow: new (
    options: BrowserWindowConstructorOptions,
  ) => BrowserWindow;
  session: {
    defaultSession: Session;
    fromPartition(partition: string): Session;
  };
}

export interface SpotifyWebProfile {
  id: string;
  name: string;
  imageUrl: string | null;
}

export interface SpotifyWebRelease {
  id: string;
  title: string;
  type: string;
  releaseDate: string;
  releaseDatePrecision: "year" | "month" | "day";
  coverUrl: string | null;
  spotifyUrl: string;
  totalTracks: number;
}

export interface SpotifyWebTrack {
  id: string;
  title: string;
  artist: string;
  /** Every credited artist, in Spotify order. */
  artists: string[];
  trackNumber: number;
  durationMs: number;
  spotifyUrl: string;
}

interface ImageSource {
  url?: string;
  width?: number;
  height?: number;
}

interface PartnerRelease {
  id?: string;
  name?: string;
  type?: string;
  uri?: string;
  date?: {
    isoString?: string;
    precision?: string;
    year?: number;
  };
  coverArt?: { sources?: ImageSource[] };
  tracks?: { totalCount?: number };
}

interface PartnerTrack {
  uri?: string;
  name?: string;
  trackNumber?: number;
  mediaType?: string;
  duration?: { totalMilliseconds?: number };
  artists?: {
    items?: Array<{ profile?: { name?: string } }>;
  };
}

interface PartnerSearchArtist {
  __typename?: string;
  data?: {
    profile?: { name?: string };
    uri?: string;
    visuals?: {
      avatarImage?: { sources?: ImageSource[] };
    };
  };
}

type HeaderBag = Record<string, string>;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function appendQuery(url: string, query: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}${query}`;
}

function headerValue(headers: HeaderBag, name: string): string | null {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted && value) return value;
  }
  return null;
}

function sanitizeHeaders(raw: HeaderBag): HeaderBag {
  const keep = [
    "authorization",
    "client-token",
    "app-platform",
    "spotify-app-version",
    "accept-language",
    "sec-ch-ua",
    "sec-ch-ua-mobile",
    "sec-ch-ua-platform",
    "user-agent",
    "accept",
    "content-type",
    "origin",
    "referer",
  ];
  const out: HeaderBag = {};
  for (const key of keep) {
    const value = headerValue(raw, key);
    if (value) out[key] = value;
  }
  return out;
}

function pickImage(sources: ImageSource[] | undefined): string | null {
  if (!sources || sources.length === 0) return null;
  const sorted = [...sources].sort(
    (a, b) =>
      (b.width ?? 0) * (b.height ?? 0) -
      (a.width ?? 0) * (a.height ?? 0),
  );
  return sorted.find((source) => source.url)?.url ?? null;
}

function artistIdFromUri(uri: string | undefined): string | null {
  if (!uri) return null;
  const match = /^spotify:artist:([A-Za-z0-9]+)$/.exec(uri);
  return match?.[1] ?? null;
}

function trackIdFromUri(uri: string | undefined): string | null {
  if (!uri) return null;
  const match = /^spotify:track:([A-Za-z0-9]+)$/.exec(uri);
  return match?.[1] ?? null;
}

function albumIdFromUri(uri: string | undefined): string | null {
  if (!uri) return null;
  const match = /^spotify:album:([A-Za-z0-9]+)$/.exec(uri);
  return match?.[1] ?? null;
}

function releaseDateFromPartner(
  release: PartnerRelease,
): Pick<SpotifyWebRelease, "releaseDate" | "releaseDatePrecision"> {
  const iso = release.date?.isoString ?? "";
  const precision =
    release.date?.precision === "YEAR"
      ? "year"
      : release.date?.precision === "MONTH"
        ? "month"
        : "day";
  if (iso) {
    if (precision === "year") {
      return { releaseDate: iso.slice(0, 4), releaseDatePrecision: precision };
    }
    if (precision === "month") {
      return { releaseDate: iso.slice(0, 7), releaseDatePrecision: precision };
    }
    return { releaseDate: iso.slice(0, 10), releaseDatePrecision: precision };
  }
  if (release.date?.year) {
    return {
      releaseDate: String(release.date.year),
      releaseDatePrecision: "year",
    };
  }
  return { releaseDate: "", releaseDatePrecision: "year" };
}

/**
 * Minimal client for the authenticated Spotify web player's partner API.
 *
 * Public Web API requests are rate limited for web-player tokens, while the
 * first-party web player keeps working. A hidden BrowserWindow supplies the
 * short-lived authorization/client-token headers; GraphQL queries are then
 * replayed from the main process.
 */
export class SpotifyWebClient {
  private session: Session | null = null;
  private headers: HeaderBag | null = null;
  private headersCapturedAt = 0;
  private credentials = "";
  private capturing: Promise<void> | null = null;

  constructor(private readonly deps: SpotifyWebDeps) {}

  async configure(spDc: string, spKey: string): Promise<void> {
    if (!spDc || !spKey) {
      throw new Error(
        "Spotify is not connected. Open Settings → Providers and sign in first.",
      );
    }
    const key = `${spDc}\u0000${spKey}`;
    if (this.session && this.credentials === key) return;
    this.credentials = key;
    this.headers = null;
    this.headersCapturedAt = 0;
    this.username = null;
    this.session = this.deps.session.fromPartition(PARTITION);
    await this.installCookies(spDc, spKey);
  }

  private async installCookies(spDc: string, spKey: string): Promise<void> {
    const ses = this.session;
    if (!ses) throw new Error("Spotify web session is not ready.");
    const expirationDate = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365;
    for (const [name, value] of [
      ["sp_dc", spDc],
      ["sp_key", spKey],
    ] as const) {
      try {
        await ses.cookies.set({
          url: "https://open.spotify.com",
          name,
          value,
          domain: ".spotify.com",
          path: "/",
          secure: true,
          httpOnly: true,
          sameSite: "no_restriction",
          expirationDate,
        });
      } catch (error) {
        console.warn(`[spotify-web] could not set ${name} cookie:`, error);
      }
    }
  }

  private async ensureHeaders(force = false): Promise<HeaderBag> {
    if (this.capturing) await this.capturing;
    if (
      !force &&
      this.headers &&
      Date.now() - this.headersCapturedAt < HEADER_TTL_MS
    ) {
      return this.headers;
    }
    this.capturing = this.captureHeaders().finally(() => {
      this.capturing = null;
    });
    await this.capturing;
    if (!this.headers) {
      throw new Error(
        "Spotify did not return an authenticated web session. Open Settings → Providers and sign in again.",
      );
    }
    return this.headers;
  }

  private async captureHeaders(): Promise<void> {
    const ses = this.session;
    if (!ses) throw new Error("Spotify web session is not ready.");

    let settle: (() => void) | null = null;
    const captured = new Promise<void>((resolve) => {
      settle = resolve;
    });

    const listener = (
      details: Electron.OnBeforeSendHeadersListenerDetails,
      callback: (response: Electron.BeforeSendResponse) => void,
    ): void => {
      try {
        if (
          !this.headers &&
          details.method === "POST" &&
          details.url.includes("api-partner.spotify.com")
        ) {
          const headers = sanitizeHeaders(details.requestHeaders);
          if (headers.authorization) {
            this.headers = headers;
            this.headersCapturedAt = Date.now();
            settle?.();
          }
        }
      } catch {
        // Never let a webRequest listener throw.
      }
      callback({ requestHeaders: details.requestHeaders });
    };

    ses.webRequest.onBeforeSendHeaders(
      { urls: ["https://api-partner.spotify.com/*"] },
      listener,
    );

    let win: BrowserWindow | null = null;
    try {
      win = new this.deps.BrowserWindow({
        show: false,
        width: 1280,
        height: 900,
        webPreferences: {
          partition: PARTITION,
          sandbox: false,
          contextIsolation: true,
          nodeIntegration: false,
          backgroundThrottling: false,
        },
      });
      win.webContents.setUserAgent(USER_AGENT);
      void win.loadURL("https://open.spotify.com/collection/artists").catch(
        () => undefined,
      );
      await Promise.race([captured, delay(WARMUP_TIMEOUT_MS)]);
    } finally {
      try {
        ses.webRequest.onBeforeSendHeaders(null);
      } catch {
        // Listener already removed.
      }
      try {
        if (win && !win.isDestroyed()) win.destroy();
      } catch {
        // Ignore destroy races.
      }
    }
  }

  private async requestHeaders(force = false): Promise<HeaderBag> {
    const headers = await this.ensureHeaders(force);
    return {
      ...headers,
      accept: "application/json",
      "content-type": "application/json;charset=UTF-8",
      origin: "https://open.spotify.com",
      referer: "https://open.spotify.com/",
    };
  }

  private async query<T>(
    operationName: string,
    variables: Record<string, unknown>,
    sha256Hash: string,
  ): Promise<T> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        // Header capture can legitimately take up to WARMUP_TIMEOUT_MS. Keep
        // it outside the request timeout, otherwise the first synced artist
        // batch aborts before its GraphQL request even starts.
        const headers = await this.requestHeaders();
        const controller = new AbortController();
        const timer = setTimeout(
          () => controller.abort(),
          REQUEST_TIMEOUT_MS,
        );
        try {
          const response = await fetch(PARTNER_ENDPOINT, {
            method: "POST",
            headers,
            signal: controller.signal,
            body: JSON.stringify({
              variables,
              operationName,
              extensions: {
                persistedQuery: { version: 1, sha256Hash },
              },
            }),
          });
          if (response.status === 401 || response.status === 403) {
            this.headers = null;
            lastError = new Error(
              `Spotify session expired (${response.status}).`,
            );
            continue;
          }
          const text = await response.text();
          if (!response.ok) {
            throw new Error(
              `Spotify web API ${response.status}: ${
                text.slice(0, 240) || response.statusText
              }`,
            );
          }
          const parsed = JSON.parse(text) as {
            data?: T;
            errors?: Array<{ message?: string }>;
          };
          if (!parsed.data) {
            const message = parsed.errors?.[0]?.message;
            throw new Error(
              message
                ? `Spotify web API: ${message}`
                : "Spotify web API returned no data.",
            );
          }
          return parsed.data;
        } finally {
          clearTimeout(timer);
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt === 0) await delay(500);
      }
    }
    throw lastError ?? new Error("Spotify web request failed.");
  }

  private username: string | null = null;

  private async currentUsername(): Promise<string> {
    if (this.username) return this.username;
    const data = await this.query<{
      me?: { profile?: { username?: string } };
    }>("profileAttributes", {}, HASHES.profileAttributes);
    const username = data.me?.profile?.username?.trim();
    if (!username) {
      throw new Error("Spotify did not return the signed-in profile.");
    }
    this.username = username;
    return username;
  }

  private async followingPage(url: string): Promise<{
    profiles?: Array<{
      uri?: string;
      name?: string;
      image_url?: string;
      is_following?: boolean;
    }>;
    next?: string | null;
    total?: number;
    has_more?: boolean;
    hasMore?: boolean;
    limit?: number;
  }> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        REQUEST_TIMEOUT_MS,
      );
      try {
        const headers = { ...(await this.ensureHeaders(attempt > 0)) };
        delete headers["content-type"];
        headers.accept = "application/json";
        const response = await fetch(url, {
          headers,
          signal: controller.signal,
        });
        if (response.status === 401 || response.status === 403) {
          this.headers = null;
          this.username = null;
          lastError = new Error(
            `Spotify following list is unavailable (${response.status}).`,
          );
          continue;
        }
        const text = await response.text();
        if (!response.ok) {
          throw new Error(
            `Spotify following list ${response.status}: ${text.slice(0, 240)}`,
          );
        }
        return JSON.parse(text);
      } catch (error) {
        lastError =
          error instanceof Error ? error : new Error(String(error));
        if (attempt === 0) await delay(500);
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError ?? new Error("Could not load followed artists.");
  }

  async following(): Promise<SpotifyWebProfile[]> {
    const username = await this.currentUsername();
    const byId = new Map<string, SpotifyWebProfile>();
    const visited = new Set<string>();
    let url: string | null =
      `https://spclient.wg.spotify.com/user-profile-view/v3/profile/${encodeURIComponent(username)}/following?market=from_token`;
    let offset = 0;

    for (let page = 0; url && page < 50; page += 1) {
      if (visited.has(url)) break;
      visited.add(url);
      const before = byId.size;
      const parsed = await this.followingPage(url);
      const profiles = parsed.profiles ?? [];
      for (const profile of profiles) {
        if (profile.is_following === false) continue;
        const id = artistIdFromUri(profile.uri);
        const name = profile.name?.trim();
        if (!id || !name || byId.has(id)) continue;
        byId.set(id, {
          id,
          name,
          imageUrl: profile.image_url ?? null,
        });
      }

      let next: string | null =
        typeof parsed.next === "string" ? parsed.next : null;
      const total =
        typeof parsed.total === "number" ? parsed.total : null;
      const hasMore =
        parsed.has_more === true || parsed.hasMore === true;
      if (
        !next &&
        profiles.length > 0 &&
        (hasMore || (total !== null && profiles.length < total))
      ) {
        offset += profiles.length;
        next = appendQuery(url, `offset=${offset}&limit=50`);
      }

      if (!next) break;
      // Some partner responses return the entire list for every offset and
      // ignore the pagination parameters. Stop if a page makes no progress.
      if (page > 0 && byId.size === before && profiles.length > 0) break;
      url = next.startsWith("http")
        ? next
        : new URL(next, "https://spclient.wg.spotify.com").toString();
    }

    return [...byId.values()];
  }

  async artistReleases(
    artistId: string,
    limit = 6,
  ): Promise<SpotifyWebRelease[]> {
    const data = await this.query<{
      artistUnion?: {
        discography?: {
          all?: { items?: Array<{ releases?: { items?: PartnerRelease[] } }> };
        };
      };
    }>(
      "queryArtistDiscographyAll",
      {
        uri: `spotify:artist:${artistId}`,
        offset: 0,
        limit,
        order: "DATE_DESC",
      },
      HASHES.queryArtistDiscographyAll,
    );

    const releases: SpotifyWebRelease[] = [];
    for (const group of data.artistUnion?.discography?.all?.items ?? []) {
      for (const release of group.releases?.items ?? []) {
        const id = release.id ?? albumIdFromUri(release.uri);
        const title = release.name?.trim();
        if (!id || !title) continue;
        const date = releaseDateFromPartner(release);
        releases.push({
          id,
          title,
          type: release.type ?? "ALBUM",
          ...date,
          coverUrl: pickImage(release.coverArt?.sources),
          spotifyUrl: `https://open.spotify.com/album/${id}`,
          totalTracks: release.tracks?.totalCount ?? 0,
        });
      }
    }
    return releases;
  }

  async albumTracks(
    albumId: string,
    fallbackArtist: string,
  ): Promise<SpotifyWebTrack[]> {
    const data = await this.query<{
      albumUnion?: {
        tracksV2?: { items?: Array<{ track?: PartnerTrack }> };
      };
    }>(
      "queryAlbumTracks",
      { uri: `spotify:album:${albumId}`, offset: 0, limit: 300 },
      HASHES.queryAlbumTracks,
    );

    const tracks: SpotifyWebTrack[] = [];
    for (const item of data.albumUnion?.tracksV2?.items ?? []) {
      const track = item.track;
      if (!track) continue;
      if (track.mediaType && track.mediaType !== "AUDIO") continue;
      const id = trackIdFromUri(track.uri);
      const title = track.name?.trim();
      if (!id || !title) continue;
      const artists: string[] = [];
      for (const item of track.artists?.items ?? []) {
        const name = item.profile?.name?.trim();
        if (name && !artists.includes(name)) artists.push(name);
      }
      tracks.push({
        id,
        title,
        artist: artists.join(", ") || fallbackArtist,
        artists,
        trackNumber: track.trackNumber ?? 0,
        durationMs: track.duration?.totalMilliseconds ?? 0,
        spotifyUrl: `https://open.spotify.com/track/${id}`,
      });
    }
    return tracks;
  }

  async searchArtists(
    term: string,
    limit = 10,
  ): Promise<SpotifyWebProfile[]> {
    const data = await this.query<{
      searchV2?: {
        artists?: { items?: PartnerSearchArtist[] };
      };
    }>(
      "searchArtists",
      {
        searchTerm: term,
        offset: 0,
        limit,
        numberOfTopResults: limit,
      },
      HASHES.searchArtists,
    );

    const artists: SpotifyWebProfile[] = [];
    for (const item of data.searchV2?.artists?.items ?? []) {
      const artist = item.data;
      const id = artistIdFromUri(artist?.uri);
      const name = artist?.profile?.name?.trim();
      if (!id || !name) continue;
      artists.push({
        id,
        name,
        imageUrl: pickImage(artist?.visuals?.avatarImage?.sources),
      });
    }
    return artists;
  }

  async setArtistFollow(artistId: string, following: boolean): Promise<void> {
    await this.query<Record<string, unknown>>(
      following ? "addToLibrary" : "removeFromLibrary",
      {
        libraryItemUris: [`spotify:artist:${artistId}`],
        interactionId: null,
      },
      HASHES.library,
    );
  }

  dispose(): void {
    this.headers = null;
    this.headersCapturedAt = 0;
    this.credentials = "";
    this.username = null;
    this.session = null;
  }
}
