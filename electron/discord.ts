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
const remoteCoverCache = new Map<string, string | null>();
const remoteCoverPending = new Map<string, Promise<string | null>>();
const uploadedCoverCache = new Map<string, string | null>();
const uploadedCoverPending = new Map<string, Promise<string | null>>();

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

async function lookupRemoteCover(
  presence: DiscordPresencePayload,
): Promise<string | null> {
  const title = normalizeName(presence.title);
  const artist = normalizeName(presence.artist);
  if (!title) return null;
  const term = `${presence.artist} ${presence.title}`.trim();
  const url =
    "https://itunes.apple.com/search?term=" +
    `${encodeURIComponent(term)}&media=music&entity=song&limit=15`;

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      results?: Array<Record<string, unknown>>;
    };
    const results = Array.isArray(payload.results) ? payload.results : [];
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
  } catch {
    return null;
  }
}

function applyResolvedCover(
  source: DiscordPresencePayload,
  artwork: string,
): void {
  if (!latest || coverKey(latest) !== coverKey(source)) return;
  if (isHttpUrl(latest.artwork)) return;
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

async function uploadCover(dataUrl: string): Promise<string | null> {
  const image = decodedDataUrl(dataUrl);
  if (!image) return null;
  const extension =
    image.type === "image/png"
      ? "png"
      : image.type === "image/webp"
        ? "webp"
        : "jpg";
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
      signal: AbortSignal.timeout(20_000),
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

function requestUploadedCover(
  source: DiscordPresencePayload,
  dataUrl: string,
): void {
  const key = dataArtworkHash(dataUrl);

  if (uploadedCoverCache.has(key)) {
    const cached = uploadedCoverCache.get(key);
    if (cached) applyResolvedCover(source, cached);
    else requestCatalogCover(source);
    return;
  }

  const inFlight = uploadedCoverPending.get(key);
  if (inFlight) {
    void inFlight.then((artwork) => {
      if (artwork) applyResolvedCover(source, artwork);
      else requestCatalogCover(source);
    });
    return;
  }

  const task = uploadCover(dataUrl)
    .then((artwork) => {
      remember(uploadedCoverCache, key, artwork, UPLOAD_CACHE_LIMIT);
      return artwork;
    })
    .catch(() => null)
    .finally(() => {
      uploadedCoverPending.delete(key);
    });

  uploadedCoverPending.set(key, task);
  void task.then((artwork) => {
    if (artwork) applyResolvedCover(source, artwork);
    else requestCatalogCover(source);
  });
}

function requestCatalogCover(source: DiscordPresencePayload): void {
  const key = coverKey(source);
  if (!key.trim()) return;

  if (remoteCoverCache.has(key)) {
    const cached = remoteCoverCache.get(key);
    if (cached) applyResolvedCover(source, cached);
    return;
  }

  const inFlight = remoteCoverPending.get(key);
  if (inFlight) {
    void inFlight.then((artwork) => {
      if (artwork) applyResolvedCover(source, artwork);
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
    if (artwork) applyResolvedCover(source, artwork);
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
  if (presence.artwork && presence.artwork.startsWith("data:")) {
    const uploaded = uploadedCoverCache.get(dataArtworkHash(presence.artwork));
    if (uploaded) return { ...presence, artwork: uploaded };
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
