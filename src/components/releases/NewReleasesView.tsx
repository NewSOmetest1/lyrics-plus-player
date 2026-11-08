import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Bell,
  Check,
  Download,
  Loader2,
  Music2,
  Play,
  RefreshCw,
  Square,
} from "lucide-react";

import type { DownloadRequest, ReleaseRecord } from "@/types";
import { backend } from "@/lib/api";
import { cn } from "@/lib/cn";
import { splitArtistNames } from "@/lib/artists";
import { useDownloadStore } from "@/store/downloadStore";
import { usePlayerStore } from "@/store/playerStore";
import {
  countNewReleases,
  normalizeArtistName,
  useReleasesStore,
} from "@/store/releasesStore";
import { useToastStore } from "@/store/toastStore";

function releaseDate(release: ReleaseRecord): Date | null {
  if (!release.releaseDate) return null;
  const full =
    release.releaseDatePrecision === "year"
      ? `${release.releaseDate}-01-01`
      : release.releaseDatePrecision === "month"
        ? `${release.releaseDate}-01`
        : release.releaseDate;
  const parsed = new Date(`${full}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function dateBadge(release: ReleaseRecord): string {
  const date = releaseDate(release);
  if (!date) return release.releaseDate || "Unknown";
  const diffDays = Math.round(
    (startOfDay(new Date()).getTime() - startOfDay(date).getTime()) /
      86_400_000,
  );
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays > 1 && diffDays < 7) return `${diffDays} days ago`;
  if (release.releaseDatePrecision === "year") return release.releaseDate;
  if (release.releaseDatePrecision === "month") {
    return date.toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
    });
  }
  if (date.getFullYear() === new Date().getFullYear()) {
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  }
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function relativeTime(timestamp: number | null): string {
  if (!timestamp) return "never";
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function toRequests(release: ReleaseRecord): DownloadRequest[] {
  return release.tracks
    .filter((track) => !track.isDownloaded)
    .map((track) => ({
      releaseId: release.id,
      trackId: track.id,
      title: track.title,
      artist: release.artist,
      album: release.title,
      coverUrl: release.coverUrl,
      spotifyUrl: track.spotifyUrl,
    }));
}

export function NewReleasesView() {
  const feed = useReleasesStore((state) => state.feed);
  const loading = useReleasesStore((state) => state.loading);
  const syncing = useReleasesStore((state) => state.syncing);
  const sync = useReleasesStore((state) => state.sync);
  const ensureFresh = useReleasesStore((state) => state.ensureFresh);
  const seenReleaseIds = useReleasesStore((state) => state.seenReleaseIds);
  const markReleasesSeen = useReleasesStore(
    (state) => state.markReleasesSeen,
  );
  const tasks = useDownloadStore((state) => state.tasks);
  const tracks = usePlayerStore((state) => state.tracks);

  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previewToken = useRef(0);

  useEffect(() => {
    void ensureFresh();
  }, [ensureFresh]);

  // Opening New Releases marks everything currently in the feed as seen, so
  // the sidebar badge and per-card unread dots clear after one visit.
  useEffect(() => {
    if (loading || feed.releases.length === 0) return;
    markReleasesSeen(feed.releases.map((release) => release.id));
  }, [feed.releases, loading, markReleasesSeen]);

  const seenReleaseIdSet = useMemo(
    () => new Set(seenReleaseIds),
    [seenReleaseIds],
  );

  const stopPreview = useCallback(() => {
    previewToken.current += 1;
    const audio = audioRef.current;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    audioRef.current = null;
    setPreviewId(null);
    setPreviewLoading(null);
  }, []);

  useEffect(() => () => stopPreview(), [stopPreview]);

  const togglePreview = async (release: ReleaseRecord) => {
    if (previewId === release.id) {
      stopPreview();
      return;
    }
    stopPreview();
    const token = previewToken.current;
    setPreviewLoading(release.id);
    let url = release.previewUrl;
    try {
      if (!url) {
        const trackId = release.tracks[0]?.id;
        if (trackId) url = await backend.getReleasePreview(trackId);
      }
    } catch (error) {
      console.warn("[releases] could not resolve preview:", error);
    }
    if (previewToken.current !== token) return;
    if (!url) {
      setPreviewLoading(null);
      useToastStore.getState().push({
        kind: "info",
        title: "No preview available",
        description: "Spotify did not provide a 30-second preview for this release.",
      });
      return;
    }
    const audio = new Audio(url);
    audio.volume = 0.85;
    audio.preload = "auto";
    audio.onended = () => {
      if (previewToken.current !== token) return;
      setPreviewId(null);
      setPreviewLoading(null);
      audioRef.current = null;
    };
    audio.onerror = () => {
      if (previewToken.current !== token) return;
      setPreviewId(null);
      setPreviewLoading(null);
      audioRef.current = null;
      useToastStore.getState().push({
        kind: "error",
        title: "Preview could not play",
        description: "The Spotify preview URL is unavailable.",
      });
    };
    audioRef.current = audio;
    void audio
      .play()
      .then(() => {
        if (previewToken.current !== token) return;
        setPreviewId(release.id);
        setPreviewLoading(null);
      })
      .catch((error) => {
        if (previewToken.current !== token) return;
        setPreviewLoading(null);
        useToastStore.getState().push({
          kind: "error",
          title: "Preview could not play",
          description: error instanceof Error ? error.message : String(error),
        });
      });
  };

  const queuedReleaseIds = useMemo(() => {
    const ids = new Set<string>();
    for (const task of tasks) {
      if (task.status === "queued" || task.status === "downloading") {
        ids.add(task.releaseId);
      }
    }
    return ids;
  }, [tasks]);

  const libraryArtists = useMemo(() => {
    const names = new Set<string>();
    for (const track of tracks) {
      for (const name of splitArtistNames(track.artist)) {
        names.add(normalizeArtistName(name));
      }
    }
    return names;
  }, [tracks]);

  const newCount = useMemo(() => countNewReleases(feed), [feed]);

  const requestDownloads = async (requests: DownloadRequest[]) => {
    if (requests.length === 0) {
      useToastStore.getState().push({
        kind: "info",
        title: "Nothing new to download",
        description: "Every track in this release is already in the library.",
      });
      return;
    }
    try {
      await useDownloadStore.getState().start(requests);
      useToastStore.getState().push({
        kind: "success",
        title: "Download queue started",
        description: `${requests.length} track${
          requests.length === 1 ? "" : "s"
        } added to the cascading FLAC downloader.`,
      });
    } catch (error) {
      useToastStore.getState().push({
        kind: "error",
        title: "Could not start download",
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const downloadRelease = (release: ReleaseRecord) => {
    void requestDownloads(toRequests(release));
  };

  const downloadAllNew = () => {
    const seen = new Set<string>();
    const requests: DownloadRequest[] = [];
    for (const release of feed.releases) {
      if (release.isDownloaded) continue;
      for (const request of toRequests(release)) {
        if (seen.has(request.trackId)) continue;
        seen.add(request.trackId);
        requests.push(request);
      }
    }
    void requestDownloads(requests);
  };

  const openArtist = (release: ReleaseRecord) => {
    const localName = splitArtistNames(release.artist).find((name) =>
      libraryArtists.has(normalizeArtistName(name)),
    );
    if (localName) {
      usePlayerStore.getState().openArtist(localName);
      return;
    }
    if (release.artistUrl) {
      window.open(release.artistUrl, "_blank", "noopener,noreferrer");
    }
  };

  const openRelease = (release: ReleaseRecord) => {
    window.open(release.spotifyUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-6 pb-8 pt-5 lg:px-8">
        <header className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.22em] text-accent/80">
              <Bell className="h-3 w-3" />
              Release radar
            </p>
            <h1 className="mt-1 font-display text-[32px] font-extrabold leading-tight tracking-[-0.03em] text-white lg:text-[38px]">
              New Releases
            </h1>
            <p className="mt-1.5 max-w-xl text-[12.5px] leading-relaxed text-white/35">
              {feed.artists.length} followed artist
              {feed.artists.length === 1 ? "" : "s"} ·{" "}
              <span className={cn(newCount > 0 ? "text-accent/90" : "text-white/40")}>
                {newCount} new
              </span>{" "}
              · last sync {relativeTime(feed.lastSyncedAt)}
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void sync()}
              disabled={syncing}
              className="flex h-9 items-center gap-2 rounded-full border border-white/[0.1] bg-white/[0.05] px-4 text-[11.5px] font-semibold text-white/65 transition hover:border-white/[0.18] hover:bg-white/[0.09] hover:text-white active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
            >
              {syncing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              {syncing ? "Syncing…" : "Sync with Spotify"}
            </button>
            <button
              type="button"
              onClick={downloadAllNew}
              disabled={newCount === 0 || syncing}
              className="flex h-9 items-center gap-2 rounded-full bg-accent px-5 text-[12px] font-bold text-black shadow-glow transition hover:brightness-110 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40"
            >
              <Download className="h-3.5 w-3.5" />
              Download All New
            </button>
          </div>
        </header>

        {!feed.authenticated && !loading && (
          <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-amber-400/15 bg-amber-400/[0.06] px-3.5 py-2.5 text-[11px] leading-relaxed text-amber-200/70">
            <Bell className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Connect Spotify in Settings → Providers to sync releases from
              artists you follow on Spotify.
            </span>
          </div>
        )}

        {feed.lastSyncWarnings.length > 0 && (
          <details className="mt-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-2.5 text-[10.5px] text-white/40">
            <summary className="cursor-pointer select-none font-semibold text-white/55">
              {feed.lastSyncWarnings.length} sync warning
              {feed.lastSyncWarnings.length === 1 ? "" : "s"}
            </summary>
            <ul className="mt-1.5 space-y-1">
              {feed.lastSyncWarnings.map((warning, index) => (
                <li key={`${warning}-${index}`} className="truncate">
                  {warning}
                </li>
              ))}
            </ul>
          </details>
        )}

        {loading ? (
          <div className="flex h-64 items-center justify-center gap-2 text-[12px] text-white/35">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading releases…
          </div>
        ) : feed.releases.length === 0 ? (
          <div className="lucid-glass-panel glass mt-6 flex flex-col items-center rounded-2xl px-6 py-16 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">
              <Bell className="h-6 w-6" />
            </span>
            <h2 className="mt-4 font-display text-[18px] font-bold text-white/85">
              {feed.authenticated
                ? "No recent releases yet"
                : "Spotify is not connected"}
            </h2>
            <p className="mt-1.5 max-w-md text-[11.5px] leading-relaxed text-white/35">
              {feed.authenticated
                ? "Artists you follow on Spotify are tracked automatically. Sync again after following more artists."
                : "Open Settings → Providers, sign in to Spotify, and sync releases from artists you follow."}
            </p>
            <button
              type="button"
              onClick={() => void sync()}
              disabled={syncing}
              className="mt-5 flex h-9 items-center gap-2 rounded-full bg-accent px-5 text-[11.5px] font-bold text-black transition hover:brightness-110 disabled:opacity-50"
            >
              {syncing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Sync with Spotify
            </button>
          </div>
        ) : (
          <div
            className="mt-5"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
              gap: "20px",
            }}
          >
            {feed.releases.map((release) => (
              <ReleaseCard
                key={release.id}
                release={release}
                previewing={previewId === release.id}
                previewLoading={previewLoading === release.id}
                downloading={queuedReleaseIds.has(release.id)}
                unread={!seenReleaseIdSet.has(release.id)}
                onPreview={() => togglePreview(release)}
                onDownload={() => downloadRelease(release)}
                onArtist={() => openArtist(release)}
                onOpen={() => openRelease(release)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ReleaseCard({
  release,
  previewing,
  previewLoading,
  downloading,
  unread,
  onPreview,
  onDownload,
  onArtist,
  onOpen,
}: {
  release: ReleaseRecord;
  previewing: boolean;
  previewLoading: boolean;
  downloading: boolean;
  unread: boolean;
  onPreview: () => void;
  onDownload: () => void;
  onArtist: () => void;
  onOpen: () => void;
}) {
  return (
    <article className="release-card lucid-glass-panel glass group flex flex-col overflow-hidden rounded-2xl transition-[transform,box-shadow] duration-300 hover:-translate-y-1 hover:shadow-[0_20px_50px_-20px_rgba(0,0,0,.8)]">
      <div className="relative aspect-square overflow-hidden bg-white/[0.04]">
        {release.coverUrl ? (
          <img
            src={release.coverUrl}
            alt={`${release.title} cover`}
            loading="lazy"
            draggable={false}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-white/[0.09] to-white/[0.02]">
            <Music2 className="h-10 w-10 text-white/25" />
          </div>
        )}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent" />
        <span className="absolute left-2 top-2 rounded-full bg-black/55 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em] text-white/80 backdrop-blur-md">
          {dateBadge(release)}
        </span>
        {unread && (
          <span
            title="New release"
            className="absolute right-2 top-2 h-2 w-2 rounded-full bg-accent shadow-[0_0_10px_var(--accent-glow)]"
          />
        )}
        <button
          type="button"
          onClick={onPreview}
          disabled={previewLoading}
          aria-label={previewing ? "Stop preview" : "Play preview"}
          title={previewing ? "Stop preview" : "Play 30-second preview"}
          className={cn(
            "absolute bottom-2 right-2 flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-black/45 text-white backdrop-blur-md transition hover:bg-accent hover:text-black focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-40",
            previewing && "bg-accent text-black",
          )}
        >
          {previewLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : previewing ? (
            <Square className="h-3 w-3 fill-current" />
          ) : (
            <Play className="ml-0.5 h-3.5 w-3.5 fill-current" />
          )}
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col p-3.5">
        <div className="flex items-center gap-1.5">
          <span className="rounded-[5px] border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-[0.12em] text-white/45">
            {release.type}
          </span>
          {release.tracks.length > 1 && (
            <span className="text-[9px] text-white/25">
              {release.tracks.length} tracks
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={onOpen}
          title={`${release.title} on Spotify`}
          className="mt-2 line-clamp-2 text-left font-display text-[13.5px] font-bold leading-snug text-white/90 outline-none transition hover:text-accent focus-visible:text-accent"
        >
          {release.title}
        </button>
        <button
          type="button"
          onClick={onArtist}
          title={`Open ${release.artist}`}
          className="mt-0.5 truncate text-left text-[11px] text-white/35 outline-none transition hover:text-white/70 focus-visible:text-white/70"
        >
          {release.artist}
        </button>

        <div className="mt-auto flex items-center gap-1 pt-3">
          <button
            type="button"
            onClick={onPreview}
            disabled={previewLoading}
            className={cn(
              "flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-white/[0.08] bg-white/[0.04] px-2 text-[9.5px] font-semibold text-white/55 transition hover:bg-white/[0.08] hover:text-white disabled:pointer-events-none disabled:opacity-35",
              previewing && "border-accent/30 bg-accent/10 text-accent",
            )}
          >
            {previewing ? (
              <Square className="h-2.5 w-2.5 fill-current" />
            ) : (
              <Play className="h-2.5 w-2.5 fill-current" />
            )}
            {previewing ? "Stop" : "Preview"}
          </button>

          {release.isDownloaded ? (
            <span className="ml-auto flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-emerald-400/20 bg-emerald-400/[0.08] px-2.5 text-[9.5px] font-bold uppercase tracking-[0.08em] text-emerald-300/80">
              <Check className="h-2.5 w-2.5" />
              In Library
            </span>
          ) : (
            <button
              type="button"
              onClick={onDownload}
              disabled={downloading || release.tracks.length === 0}
              className="ml-auto flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-accent px-2 text-[9.5px] font-bold text-black transition hover:brightness-110 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
            >
              {downloading ? (
                <Loader2 className="h-2.5 w-2.5 animate-spin" />
              ) : (
                <Download className="h-2.5 w-2.5" />
              )}
              {downloading ? "Downloading" : "Download FLAC"}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
