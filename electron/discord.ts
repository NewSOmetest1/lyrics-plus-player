import { createHash } from "node:crypto";

import { Client } from "@xhayper/discord-rpc";

export interface DiscordPresencePayload {
  title: string;
  artist: string;
  album: string;
  artwork: string | null;
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;
}

let client: Client | null = null;
let clientId = "";
let ready = false;
let generation = 0;
let retryTimer: NodeJS.Timeout | null = null;
let pending: DiscordPresencePayload | null | undefined;
let latest: DiscordPresencePayload | null = null;
let lastKey = "";
let sending = false;

const COVER_CACHE_LIMIT = 64;
const UPLOAD_CACHE_LIMIT = 128;
const UPLOAD_RETRY_MS = 2 * 60_000;
/** Uguu removes files after three hours; refresh the URL before that. */
const TEMPORARY_COVER_TTL_MS = 2.75 * 60 * 60_000;
const UPLOAD_TIMEOUT_MS = 20_000;
const UPLOAD_CHECK_TIMEOUT_MS = 12_000;
const remoteCoverCache = new Map<string, string | null>();
const remoteCoverPending = new Map<string, Promise<string | null>>();
const uploadedCoverCache = new Map<
  string,
  { url: string; expiresAt: number }
>();
const uploadedCoverPending = new Map<string, Promise<string | null>>();
const uploadRetryAt = new Map<string, number>();

function isHttpUrl(value: string | null | undefined): boolean {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

function artworkKey(artwork: string | null): string {
  if (!artwork) return "";
  return `${artwork.length}:${artwork.slice(-48)}`;
}

function coverKey(presence: DiscordPresencePayload): string {
  return [presence.title, presence.artist, presence.album]
    .map((value) => value.trim().toLowerCase())
    .join("\u0000");
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/\((?:feat|ft|with)[^)]*\)/gi, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\s+-\s+(?:remaster(?:ed)?|live|radio edit|explicit).*$/i, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeAlbum(value: string): string {
  return normalizeName(value.replace(/\s+-\s+(?:single|ep)\s*$/i, ""));
}

function upscaleArtwork(url: string): string {
  return url.replace(
    /\/(\d+)x(\d+)(bb|sr)?\.(jpg|jpeg|png|webp)$/i,
    "/600x600bb.$4",
  );
}

function matchScore(
  item: Record<string, unknown>,
  title: string,
  artist: string,
  album: string,
): number {
  const itemTitle = normalizeName(String(item.trackName ?? ""));
  if (!itemTitle || !title) return -1;
  const titleExact = itemTitle === title;
  if (!titleExact && !itemTitle.includes(title) && !title.includes(itemTitle)) {
    return -1;
  }
  let score = titleExact ? 5 : 2;

  const itemArtist = normalizeName(String(item.artistName ?? ""));
  if (artist) {
    if (itemArtist === artist) {
      score += 3;
    } else if (itemArtist.includes(artist) || artist.includes(itemArtist)) {
      score += 2;
    } else if (
      itemArtist
        .split(" ")
        .some((part) => part.length > 2 && artist.includes(part))
    ) {
      score += 1;
    } else {
      return -1;
    }
  }

  const itemAlbum = normalizeName(String(item.collectionName ?? ""));
  if (album && itemAlbum === album) score += 1;
  return score;
}

async function searchItunes(
  term: string,
  entity: "song" | "album",
  limit: number,
): Promise<Array<Record<string, unknown>>> {
  if (!term.trim()) return [];
  try {
    const url =
      "https://itunes.apple.com/search?term=" +
      `${encodeURIComponent(term)}&media=music&entity=${entity}&limit=${limit}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as {
      results?: Array<Record<string, unknown>>;
    };
    return Array.isArray(payload.results) ? payload.results : [];
  } catch {
    return [];
  }
}

function artistMatches(itemArtist: string, artist: string): boolean {
  if (!artist) return true;
  if (itemArtist === artist) return true;
  if (itemArtist.includes(artist) || artist.includes(itemArtist)) return true;
  return itemArtist
    .split(" ")
    .some((part) => part.length > 2 && artist.includes(part));
}

async function lookupSongCover(
  presence: DiscordPresencePayload,
): Promise<string | null> {
  const title = normalizeName(presence.title);
  const artist = normalizeName(presence.artist);
  if (!title) return null;
  const results = await searchItunes(
    `${presence.artist} ${presence.title}`,
    "song",
    15,
  );
  const album = normalizeName(presence.album);
  let best: { score: number; artwork: string } | null = null;

  for (const item of results) {
    const raw = item.artworkUrl100 ?? item.artworkUrl60 ?? item.artworkUrl600;
    if (typeof raw !== "string") continue;
    const score = matchScore(item, title, artist, album);
    if (score < 0) continue;
    if (!best || score > best.score) {
      best = { score, artwork: upscaleArtwork(raw) };
    }
  }

  if (!best) return null;
  return best.score >= (artist ? 5 : 4) ? best.artwork : null;
}

/**
 * Song search fails for tracks whose local tags differ from the store
 * (for example "alone"), but the album is still in the catalog. Searching
 * artist + album as songs returns sibling tracks carrying the album art.
 */
async function lookupAlbumCover(
  presence: DiscordPresencePayload,
): Promise<string | null> {
  const album = normalizeAlbum(presence.album);
  const artist = normalizeName(presence.artist);
  if (!album) return null;
  const term = [presence.artist, presence.album]
    .filter((value) => value.trim())
    .join(" ");
  const results = await searchItunes(term, "song", 25);
  let best: { score: number; artwork: string } | null = null;

  for (const item of results) {
    const raw = item.artworkUrl100 ?? item.artworkUrl60 ?? item.artworkUrl600;
    if (typeof raw !== "string") continue;
    const itemAlbum = normalizeAlbum(String(item.collectionName ?? ""));
    if (!itemAlbum) continue;
    const albumExact = itemAlbum === album;
    if (
      !albumExact &&
      !itemAlbum.includes(album) &&
      !album.includes(itemAlbum)
    ) {
      continue;
    }
    const itemArtist = normalizeName(String(item.artistName ?? ""));
    if (!artistMatches(itemArtist, artist)) continue;
    const score = (albumExact ? 4 : 2) + (itemArtist === artist ? 2 : 1);
    if (!best || score > best.score) {
      best = { score, artwork: upscaleArtwork(raw) };
    }
  }

  return best?.artwork ?? null;
}

async function lookupRemoteCover(
  presence: DiscordPresencePayload,
): Promise<string | null> {
  const songCover = await lookupSongCover(presence);
  if (songCover) return songCover;
  return lookupAlbumCover(presence);
}

function applyResolvedCover(
  source: DiscordPresencePayload,
  artwork: string,
  allowLocalOverride = false,
): void {
  if (!latest || coverKey(latest) !== coverKey(source)) return;
  if (isHttpUrl(latest.artwork) && !allowLocalOverride) return;
  // A data URL means the track has embedded art and an upload may still be
  // running. Catalog art must not preempt it unless the upload has failed.
  if (
    !allowLocalOverride &&
    latest.artwork?.toLowerCase().startsWith("data:")
  ) {
    return;
  }
  if (latest.artwork === artwork) return;
  latest = { ...latest, artwork };
  pending = latest;
  void flush();
}

function remember(
  cache: Map<string, string | null>,
  key: string,
  value: string | null,
  limit: number,
): void {
  cache.set(key, value);
  if (cache.size <= limit) return;
  const oldest = cache.keys().next().value;
  if (oldest !== undefined) cache.delete(oldest);
}

function dataArtworkHash(dataUrl: string): string {
  return createHash("sha1").update(dataUrl).digest("hex");
}

function decodedDataUrl(
  dataUrl: string,
): { bytes: Buffer; type: string } | null {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(
    dataUrl,
  );
  if (!match) return null;
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length < 256 || bytes.length > 4_000_000) return null;
  return { bytes, type: match[1].toLowerCase() };
}

interface UploadedCover {
  url: string;
  /** Epoch ms; 0 means the host keeps the file. */
  expiresAt: number;
}

async function checkImageUrl(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(UPLOAD_CHECK_TIMEOUT_MS),
      redirect: "follow",
    });
    if (!response.ok) return false;
    const type = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!type.startsWith("image/")) return false;
    const bytes = await response.arrayBuffer();
    return bytes.byteLength > 0;
  } catch {
    return false;
  }
}

function coverForm(
  image: { bytes: Buffer; type: string },
  extension: string,
): FormData {
  const form = new FormData();
  form.append(
    "files[]",
    new Blob([Uint8Array.from(image.bytes)], { type: image.type }),
    `cover.${extension}`,
  );
  return form;
}

function uploadedUrlFrom(
  payload: unknown,
  hostSuffix: string,
): string | null {
  if (!payload || typeof payload !== "object") return null;
  const files = (payload as { files?: unknown }).files;
  if (!Array.isArray(files) || files.length === 0) return null;
  const url = (files[0] as { url?: unknown } | null)?.url;
  if (typeof url !== "string" || !isHttpUrl(url)) return null;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === hostSuffix || host.endsWith(`.${hostSuffix}`) ? url : null;
  } catch {
    return null;
  }
}

async function uploadToUguu(
  image: { bytes: Buffer; type: string },
  extension: string,
): Promise<string | null> {
  try {
    const response = await fetch("https://uguu.se/upload.php", {
      method: "POST",
      body: coverForm(image, extension),
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return uploadedUrlFrom(await response.json(), "uguu.se");
  } catch {
    return null;
  }
}

async function uploadToPomf2(
  image: { bytes: Buffer; type: string },
  extension: string,
): Promise<string | null> {
  try {
    const response = await fetch("https://pomf2.lain.la/upload.php", {
      method: "POST",
      body: coverForm(image, extension),
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return uploadedUrlFrom(await response.json(), "lain.la");
  } catch {
    return null;
  }
}

async function uploadToCatbox(
  image: { bytes: Buffer; type: string },
  extension: string,
): Promise<string | null> {
  const form = new FormData();
  form.append("reqtype", "fileupload");
  form.append(
    "fileToUpload",
    new Blob([Uint8Array.from(image.bytes)], { type: image.type }),
    `cover.${extension}`,
  );

  try {
    const response = await fetch("https://catbox.moe/user/api.php", {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const url = (await response.text()).trim();
    return /^https:\/\/files\.catbox\.moe\/[A-Za-z0-9]+\.[A-Za-z0-9]+$/.test(
      url,
    )
      ? url
      : null;
  } catch {
    return null;
  }
}

/**
 * Uguu is fast but removes files after three hours, so its URLs get a TTL.
 * Pomf2 keeps files and backs it up; Catbox is last because its responses
 * have been returning empty images.
 */
const UPLOAD_PROVIDERS: Array<{
  temporary: boolean;
  upload: (
    image: { bytes: Buffer; type: string },
    extension: string,
  ) => Promise<string | null>;
}> = [
  { temporary: true, upload: uploadToUguu },
  { temporary: false, upload: uploadToPomf2 },
  { temporary: false, upload: uploadToCatbox },
];

async function uploadCover(dataUrl: string): Promise<UploadedCover | null> {
  const image = decodedDataUrl(dataUrl);
  if (!image) return null;
  const extension =
    image.type === "image/png"
      ? "png"
      : image.type === "image/webp"
        ? "webp"
        : "jpg";

  for (const provider of UPLOAD_PROVIDERS) {
    const url = await provider.upload(image, extension);
    if (!url) continue;
    // Catbox answered 200 with a zero-byte body, which Discord renders as a
    // broken-image placeholder. Only use a URL that actually serves an image.
    if (!(await checkImageUrl(url))) continue;
    return {
      url,
      expiresAt: provider.temporary
        ? Date.now() + TEMPORARY_COVER_TTL_MS
        : 0,
    };
  }

  return null;
}

function cachedUploadedCover(key: string): string | null {
  const entry = uploadedCoverCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt > 0 && entry.expiresAt <= Date.now()) {
    uploadedCoverCache.delete(key);
    return null;
  }
  return entry.url;
}

function rememberUploadedCover(key: string, cover: UploadedCover): void {
  uploadedCoverCache.set(key, cover);
  if (uploadedCoverCache.size <= UPLOAD_CACHE_LIMIT) return;
  const oldest = uploadedCoverCache.keys().next().value;
  if (oldest !== undefined) uploadedCoverCache.delete(oldest);
}

function requestUploadedCover(
  source: DiscordPresencePayload,
  dataUrl: string,
): void {
  const key = dataArtworkHash(dataUrl);

  const cached = cachedUploadedCover(key);
  if (cached) {
    applyResolvedCover(source, cached, true);
    return;
  }

  const retryAt = uploadRetryAt.get(key);
  if (retryAt && Date.now() < retryAt) {
    requestCatalogCover(source, true);
    return;
  }

  const inFlight = uploadedCoverPending.get(key);
  if (inFlight) {
    void inFlight.then((artwork) => {
      if (artwork) applyResolvedCover(source, artwork, true);
      else requestCatalogCover(source, true);
    });
    return;
  }

  const task = uploadCover(dataUrl)
    .then((cover) => {
      if (!cover) {
        uploadRetryAt.set(key, Date.now() + UPLOAD_RETRY_MS);
        return null;
      }
      uploadRetryAt.delete(key);
      rememberUploadedCover(key, cover);
      return cover.url;
    })
    .catch(() => null)
    .finally(() => {
      uploadedCoverPending.delete(key);
    });

  uploadedCoverPending.set(key, task);
  void task.then((artwork) => {
    if (artwork) applyResolvedCover(source, artwork, true);
    else requestCatalogCover(source, true);
  });
}

function requestCatalogCover(
  source: DiscordPresencePayload,
  force = false,
): void {
  const key = coverKey(source);
  if (!key.trim()) return;

  if (remoteCoverCache.has(key)) {
    const cached = remoteCoverCache.get(key);
    if (cached) applyResolvedCover(source, cached, force);
    return;
  }

  const inFlight = remoteCoverPending.get(key);
  if (inFlight) {
    void inFlight.then((artwork) => {
      if (artwork) applyResolvedCover(source, artwork, force);
    });
    return;
  }

  const task = lookupRemoteCover(source)
    .then((artwork) => {
      remember(remoteCoverCache, key, artwork, COVER_CACHE_LIMIT);
      return artwork;
    })
    .catch(() => null)
    .finally(() => {
      remoteCoverPending.delete(key);
    });

  remoteCoverPending.set(key, task);
  void task.then((artwork) => {
    if (artwork) applyResolvedCover(source, artwork, force);
  });
}

function requestRemoteCover(source: DiscordPresencePayload): void {
  if (isHttpUrl(source.artwork)) return;
  if (source.artwork && source.artwork.startsWith("data:")) {
    requestUploadedCover(source, source.artwork);
    return;
  }
  requestCatalogCover(source);
}

/** Reuse an already resolved URL so frequent updates never flicker the art. */
function resolvedArtworkFor(
  presence: DiscordPresencePayload,
): DiscordPresencePayload {
  if (isHttpUrl(presence.artwork)) return presence;
  if (presence.artwork && presence.artwork.toLowerCase().startsWith("data:")) {
    // Embedded art is the primary source: only reuse an upload of this exact
    // image, never a catalog lookup that may be a different release.
    const uploaded = cachedUploadedCover(dataArtworkHash(presence.artwork));
    return uploaded ? { ...presence, artwork: uploaded } : presence;
  }
  const catalog = remoteCoverCache.get(coverKey(presence));
  if (catalog) return { ...presence, artwork: catalog };
  return presence;
}

function truncate(value: string, length = 128): string {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

function activityFor(presence: DiscordPresencePayload) {
  const now = Date.now();
  const position = Math.max(0, presence.positionMs);
  const duration = Math.max(0, presence.durationMs);
  const artist = presence.artist.trim() || "Unknown artist";
  const title = presence.title.trim() || "Unknown track";

  return {
    // Listening reads like Spotify's card; Details makes the member list show
    // the track title instead of the app name.
    type: 2,
    statusDisplayType: 2,
    details: truncate(title),
    state: truncate(
      presence.isPlaying ? artist : `Paused · ${artist}`,
    ),
    // Discord expects an external image URL in large_image (largeImageKey);
    // large_url is only the click-through link.
    largeImageKey: isHttpUrl(presence.artwork)
      ? (presence.artwork ?? undefined)
      : undefined,
    largeImageText: presence.album.trim() || undefined,
    startTimestamp: presence.isPlaying ? new Date(now - position) : undefined,
    endTimestamp:
      presence.isPlaying && duration > 0
        ? new Date(now - position + duration)
        : undefined,
  };
}

function keyFor(presence: DiscordPresencePayload | null): string {
  if (!presence) return "none";
  return [
    presence.title,
    presence.artist,
    presence.album,
    presence.isPlaying ? "1" : "0",
    Math.round(presence.positionMs / 1000),
    Math.round(presence.durationMs / 1000),
    artworkKey(presence.artwork),
  ].join("|");
}

function clearRetry(): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
}

function scheduleRetry(): void {
  if (!clientId || retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    connect();
  }, 30_000);
}

async function flush(): Promise<void> {
  if (!ready || !client?.user || sending) return;
  const next = pending;
  pending = undefined;
  if (next === undefined) return;

  const key = keyFor(next);
  if (key === lastKey) return;

  sending = true;
  try {
    if (next) await client.user.setActivity(activityFor(next));
    else await client.user.clearActivity();
    lastKey = key;
  } catch {
    // Discord can disappear at any moment; the reconnect timer handles it.
  } finally {
    sending = false;
    if (pending !== undefined) void flush();
  }
}

function connect(): void {
  if (!clientId) return;
  clearRetry();
  const currentGeneration = ++generation;
  const previous = client;
  client = null;
  ready = false;
  lastKey = "";
  if (previous) void previous.destroy().catch(() => undefined);

  const next = new Client({ clientId });
  client = next;

  next.on("ready", () => {
    if (currentGeneration !== generation) return;
    ready = true;
    lastKey = "";
    void flush();
  });

  next.on("disconnected", () => {
    if (currentGeneration !== generation) return;
    ready = false;
    scheduleRetry();
  });

  void next.login().catch(() => {
    if (currentGeneration !== generation) return;
    ready = false;
    scheduleRetry();
  });
}

/**
 * Reconnect with a new Discord application id. An empty id disables RPC
 * entirely, which is the default until the user configures an app.
 */
export function initDiscordRpc(id: string | null | undefined): void {
  const nextId = id?.trim() ?? "";
  if (nextId === clientId && (client || !nextId)) return;
  clientId = nextId;
  generation += 1;
  ready = false;
  latest = null;
  clearRetry();
  if (client) {
    void client.destroy().catch(() => undefined);
    client = null;
  }
  if (!clientId) return;
  connect();
}

export function updateDiscordRpc(
  presence: DiscordPresencePayload | null | undefined,
): void {
  if (presence === undefined) return;
  const resolved = presence ? resolvedArtworkFor(presence) : null;
  latest = resolved;
  pending = resolved;
  void flush();
  if (resolved) requestRemoteCover(resolved);
}

export function destroyDiscordRpc(): void {
  generation += 1;
  clientId = "";
  ready = false;
  latest = null;
  clearRetry();
  if (client) void client.destroy().catch(() => undefined);
  client = null;
}
