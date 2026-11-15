import { net } from "electron";

export interface MediaRangeProbe {
  ok: boolean;
  type: string;
  total: number;
}

function headerValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

/**
 * Probe a media URL through Chromium's network stack. The renderer plays the
 * stream through the same stack, including system proxy settings, so a URL
 * that fails here is exactly the URL the audio element cannot load.
 */
export function probeMediaRange(
  url: string,
  range: string,
  timeoutMs: number,
): Promise<MediaRangeProbe | null> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const finish = (value: MediaRangeProbe | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try {
        request.abort();
      } catch {
        // The request may already have completed.
      }
      resolve(value);
    };

    const request = net.request({
      method: "GET",
      url,
      redirect: "follow",
    });
    request.setHeader("Range", range);
    request.on("response", (response) => {
      const contentRange = headerValue(response.headers["content-range"]);
      finish({
        ok: response.statusCode >= 200 && response.statusCode < 300,
        type: headerValue(response.headers["content-type"]).toLowerCase(),
        total: Number(contentRange.split("/")[1]),
      });
    });
    request.on("error", () => finish(null));
    timer = setTimeout(() => finish(null), timeoutMs);
    request.end();
  });
}
