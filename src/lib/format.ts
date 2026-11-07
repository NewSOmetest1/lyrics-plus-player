export function formatTime(ms: number, forceHours = false): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0 || forceHours) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatTimeLong(ms: number): string {
  const totalMinutes = Math.round(ms / 60_000);
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours} hr ${minutes} min`;
}

/** Listening time for the personal stats screen: "38 hr 15 min". */
export function formatListenDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "0 min";
  if (totalSeconds < 60) return `${Math.max(1, Math.round(totalSeconds))} sec`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours} hr ${minutes} min`;
  return `${totalMinutes} min`;
}

export function formatSampleRate(hz: number | null): string | null {
  if (!hz) return null;
  const khz = hz / 1000;
  return `${Number.isInteger(khz) ? khz : khz.toFixed(1)} kHz`;
}

export function formatBitrate(kbps: number | null): string | null {
  if (!kbps) return null;
  return `${kbps.toLocaleString("en-US")} kbps`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? singular : plural}`;
}

export function formatSource(source: string | null): string {
  switch (source) {
    case "lrclib":
      return "LRCLIB";
    case "embedded":
      return "Embedded tags";
    case "local":
      return "Local .lrc";
    case "musixmatch":
      return "Musixmatch";
    case "cache":
      return "Cached";
    default:
      return source ? source.replace(/^\w/, (c) => c.toUpperCase()) : "Unknown";
  }
}

export function initials(text: string): string {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function formatQuality(track: {
  format: string;
  bitDepth: number | null;
  sampleRate: number | null;
}): string {
  const rate = formatSampleRate(track.sampleRate);
  if (track.bitDepth && rate) return `${track.bitDepth}-bit / ${rate}`;
  if (rate) return rate;
  return track.format;
}
