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
let lastKey = "";
let sending = false;

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
    details: truncate(title),
    state: truncate(
      presence.isPlaying ? artist : `Paused · ${artist}`,
    ),
    largeImageUrl:
      presence.artwork && presence.artwork.startsWith("data:")
        ? presence.artwork
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
    presence.artwork ? "art" : "",
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
  pending = presence;
  void flush();
}

export function destroyDiscordRpc(): void {
  generation += 1;
  clientId = "";
  ready = false;
  clearRetry();
  if (client) void client.destroy().catch(() => undefined);
  client = null;
}
