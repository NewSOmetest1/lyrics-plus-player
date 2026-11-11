import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

import { protocol } from "electron";

import { touchCoverAccess } from "./covers-lru";
import { isAudioFile } from "./scanner";

const MIME_TYPES: Record<string, string> = {
  ".flac": "audio/flac",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".opus": "audio/ogg",
  ".wav": "audio/wav",
  ".aiff": "audio/aiff",
  ".aif": "audio/aiff",
  ".wv": "audio/x-wavpack",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
};

export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: "media",
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true,
      },
    },
  ]);
}

function mimeFor(filePath: string): string {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Range",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges",
  "Cross-Origin-Resource-Policy": "cross-origin",
};

/**
 * Chromium can hand `media://` URLs over with percent escapes still intact
 * (Cyrillic names, spaces). Decode before touching the filesystem.
 */
function decodeMediaPath(value: string | null): string | null {
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function serveFile(
  filePath: string,
  request: Request,
  cacheControl = "no-cache",
  onServed?: (filePath: string) => void,
): Promise<Response> {
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  if (!stat.isFile()) return new Response("Not found", { status: 404 });

  onServed?.(filePath);

  const total = stat.size;
  const headers: Record<string, string> = {
    ...CORS_HEADERS,
    "Content-Type": mimeFor(filePath),
    "Accept-Ranges": "bytes",
    "Cache-Control": cacheControl,
  };

  const range = request.headers.get("range");
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (match) {
      const start = match[1] ? Number.parseInt(match[1], 10) : 0;
      const end = match[2] ? Number.parseInt(match[2], 10) : total - 1;
      if (start <= end && start < total) {
        const safeEnd = Math.min(end, total - 1);
        headers["Content-Range"] = `bytes ${start}-${safeEnd}/${total}`;
        headers["Content-Length"] = String(safeEnd - start + 1);
        const stream = createReadStream(filePath, { start, end: safeEnd });
        return new Response(Readable.toWeb(stream) as ReadableStream, {
          status: 206,
          headers,
        });
      }
    }
    return new Response(null, {
      status: 416,
      headers: { ...CORS_HEADERS, "Content-Range": `bytes */${total}` },
    });
  }

  headers["Content-Length"] = String(total);
  const stream = createReadStream(filePath);
  return new Response(Readable.toWeb(stream) as ReadableStream, { headers });
}

export function registerMediaProtocol(coversDir: string): void {
  protocol.handle("media", async (request) => {
    const url = new URL(request.url);

    if (url.hostname === "covers") {
      const file = decodeMediaPath(url.searchParams.get("file"));
      if (!file) return new Response("Not found", { status: 404, headers: CORS_HEADERS });
      const safeName = path.basename(file);
      const target = path.join(coversDir, safeName);
      // Cover names are content-addressed, so a stored file never changes.
      // Let Chromium keep decoded artwork instead of revalidating each time.
      return serveFile(
        target,
        request,
        "public, max-age=31536000, immutable",
        // LRU bookkeeping: frequently played artwork must survive pruning.
        touchCoverAccess,
      );
    }

    if (url.hostname === "audio") {
      const file = decodeMediaPath(url.searchParams.get("path"));
      if (!file || !isAudioFile(file)) {
        return new Response("Not found", { status: 404, headers: CORS_HEADERS });
      }
      return serveFile(path.resolve(file), request);
    }

    return new Response("Not found", { status: 404, headers: CORS_HEADERS });
  });
}
