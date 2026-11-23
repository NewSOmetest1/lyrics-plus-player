/**
 * Fast public YouTube search through the Innertube endpoint.
 *
 * `yt-dlp ytsearch` spawns Python and takes ~1.5 s. The same search endpoint
 * answers in ~0.5 s. This is only an optimization: every failure returns null
 * and the caller falls back to yt-dlp, so a schema change cannot break stream
 * resolution.
 */

const YOUTUBE_ORIGIN = "https://www.youtube.com";
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
/** Innertube keys change with player releases, not every request. */
const CLIENT_TTL_MS = 6 * 60 * 60 * 1000;
/** Bound the whole direct attempt so a slow request cannot delay yt-dlp long. */
const DIRECT_DEADLINE_MS = 3_000;

export interface YoutubeSearchEntry {
  id: string;
  title: string;
  duration?: number;
  channel: string;
  url: string;
}

interface InnertubeClient {
  key: string;
  version: string;
  visitor: string;
  fetchedAt: number;
}

let cachedClient: InnertubeClient | null = null;
let clientRequest: Promise<InnertubeClient | null> | null = null;

function textOf(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  if (typeof record.simpleText === "string") return record.simpleText.trim();
  if (!Array.isArray(record.runs)) return "";
  return record.runs
    .map((run) => {
      if (!run || typeof run !== "object") return "";
      const text = (run as Record<string, unknown>).text;
      return typeof text === "string" ? text : "";
    })
    .join("")
    .trim();
}

/** Convert "3:24" / "1:02:03" into seconds. Live badges have no duration. */
function secondsOf(value: string): number | undefined {
  const parts = value.trim().split(":");
  if (parts.length < 2 || parts.length > 3) return undefined;
  const numbers = parts.map(Number);
  if (numbers.some((part) => !Number.isFinite(part) || part < 0)) return undefined;
  return numbers.reduce((total, part) => total * 60 + part, 0);
}

function collectVideos(
  node: unknown,
  limit: number,
  out: YoutubeSearchEntry[],
  seen: Set<string>,
): void {
  if (out.length >= limit || !node || typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  const renderer = record.videoRenderer;
  if (renderer && typeof renderer === "object") {
    const video = renderer as Record<string, unknown>;
    const id = typeof video.videoId === "string" ? video.videoId : "";
    const title = textOf(video.title);
    if (id && title && !seen.has(id)) {
      seen.add(id);
      out.push({
        id,
        title,
        duration: secondsOf(textOf(video.lengthText)),
        channel:
          textOf(video.ownerText) ||
          textOf(video.longBylineText) ||
          textOf(video.shortBylineText),
        url: `${YOUTUBE_ORIGIN}/watch?v=${id}`,
      });
    }
  }
  for (const value of Object.values(record)) {
    if (out.length >= limit) return;
    if (Array.isArray(value)) {
      for (const item of value) collectVideos(item, limit, out, seen);
    } else if (value && typeof value === "object") {
      collectVideos(value, limit, out, seen);
    }
  }
}

async function fetchText(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<string | null> {
  try {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(Math.max(250, timeoutMs)),
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

async function loadClient(deadline: number): Promise<InnertubeClient | null> {
  if (
    cachedClient &&
    Date.now() - cachedClient.fetchedAt < CLIENT_TTL_MS
  ) {
    return cachedClient;
  }
  if (clientRequest) return clientRequest;

  clientRequest = (async () => {
    const html = await fetchText(
      `${YOUTUBE_ORIGIN}/?hl=en&gl=US`,
      {
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "User-Agent": USER_AGENT,
        },
      },
      deadline - Date.now(),
    );
    if (!html) return null;
    const key = /"INNERTUBE_API_KEY":"([^"]+)"/.exec(html)?.[1];
    const version = /"INNERTUBE_CLIENT_VERSION":"([^"]+)"/.exec(html)?.[1];
    const visitor =
      /"VISITOR_DATA":"([^"]+)"/.exec(html)?.[1] ??
      /"visitorData":"([^"]+)"/.exec(html)?.[1] ??
      "";
    if (!key || !version) return null;
    cachedClient = { key, version, visitor, fetchedAt: Date.now() };
    return cachedClient;
  })();

  try {
    return await clientRequest;
  } finally {
    clientRequest = null;
  }
}

/**
 * Search YouTube without spawning yt-dlp. Returns null on any failure so the
 * caller can retry through the proven yt-dlp path.
 */
export async function searchYoutube(
  query: string,
  limit: number,
): Promise<YoutubeSearchEntry[] | null> {
  const text = query.trim();
  if (!text || limit <= 0) return null;

  const deadline = Date.now() + DIRECT_DEADLINE_MS;
  const client = await loadClient(deadline);
  if (!client) return null;

  const payload = await fetchText(
    `${YOUTUBE_ORIGIN}/youtubei/v1/search?key=${encodeURIComponent(client.key)}&prettyPrint=false`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": USER_AGENT,
        ...(client.visitor ? { "X-Goog-Visitor-Id": client.visitor } : {}),
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: "WEB",
            clientVersion: client.version,
            hl: "en",
            gl: "US",
            ...(client.visitor ? { visitorData: client.visitor } : {}),
          },
        },
        query: text,
      }),
    },
    deadline - Date.now(),
  );
  if (!payload) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }

  const entries: YoutubeSearchEntry[] = [];
  collectVideos(parsed, limit, entries, new Set());
  return entries.length > 0 ? entries : null;
}
