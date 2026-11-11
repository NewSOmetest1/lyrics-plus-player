import { useEffect, useRef } from "react";

import { backend, coverUrl } from "@/lib/api";
import { usePlayerStore } from "@/store/playerStore";
import type { Track } from "@/types";

const ARTWORK_CACHE_LIMIT = 24;
const ARTWORK_MAX_SIDE = 512;
const ARTWORK_MAX_BYTES = 20_000_000;
const ARTWORK_MAX_DATA_URL = 1_800_000;
const artworkCache = new Map<string, string>();
const artworkPending = new Map<string, Promise<string | null>>();

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Chromium rejects MediaMetadata artwork whose data URL exceeds its URL
 * length limit and dumps the whole base64 string to the terminal. Downscale
 * covers to 512 px before encoding so MPRIS gets a compact image.
 */
async function blobToArtworkDataUrl(blob: Blob): Promise<string> {
  try {
    const bitmap = await createImageBitmap(blob);
    try {
      const scale = Math.min(
        1,
        ARTWORK_MAX_SIDE / Math.max(bitmap.width, bitmap.height),
      );
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) return blobToDataUrl(blob);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(bitmap, 0, 0, width, height);
      return canvas.toDataURL("image/jpeg", 0.85);
    } finally {
      bitmap.close();
    }
  } catch {
    return blobToDataUrl(blob);
  }
}

/**
 * Chromium writes downsampled MPRIS artwork to a temp file, but it only does so
 * for URLs it can fetch itself. Our custom media:// covers are readable by the
 * renderer, not by the desktop shell, so convert them into data URLs.
 */
async function artworkDataUrl(track: Track | null): Promise<string | null> {
  if (!track) return null;
  const url = coverUrl(track, true);
  if (!url) return null;
  if (url.startsWith("data:")) {
    return url.length > ARTWORK_MAX_DATA_URL ? null : url;
  }

  const cached = artworkCache.get(url);
  if (cached) return cached;

  const pending = artworkPending.get(url);
  if (pending) return pending;

  const task = fetch(url)
    .then(async (response) => {
      if (!response.ok) return url;
      const blob = await response.blob();
      // Keep the encoded data URL below Chromium's MediaImage URL limit.
      if (blob.size === 0 || blob.size > ARTWORK_MAX_BYTES) return url;
      const data = await blobToArtworkDataUrl(blob);
      if (data.length > ARTWORK_MAX_DATA_URL) return url;
      artworkCache.set(url, data);
      if (artworkCache.size > ARTWORK_CACHE_LIMIT) {
        const oldest = artworkCache.keys().next().value;
        if (oldest) artworkCache.delete(oldest);
      }
      return data;
    })
    .catch(() => url)
    .finally(() => {
      artworkPending.delete(url);
    });

  artworkPending.set(url, task);
  return task;
}

function metadataFor(track: Track, artwork: string | null): MediaMetadata {
  return new MediaMetadata({
    title: track.title,
    artist: track.artist,
    album: track.album || "",
    artwork: artwork
      ? [{ src: artwork, sizes: "512x512", type: artwork.slice(5, artwork.indexOf(";")) || "image/jpeg" }]
      : [],
  });
}

/**
 * Mirrors the renderer player into the OS media widget (MPRIS on Linux) and
 * Discord Rich Presence. Chromium owns the MPRIS service, so the job here is
 * metadata, playback state and native hardware-key handlers.
 */
export function useSystemIntegration(): void {
  const track = usePlayerStore((state) => state.currentTrack);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const durationMs = usePlayerStore((state) => state.durationMs);

  const artworkRef = useRef<{ trackId: number; artwork: string | null } | null>(
    null,
  );
  const trackRef = useRef<Track | null>(null);
  const positionStateRef = useRef({ at: 0, position: -1 });
  const discordRef = useRef({ at: 0, position: -1, playing: false, trackId: -1 });

  const sendDiscord = (force = false) => {
    const state = usePlayerStore.getState();
    const current = state.currentTrack;
    if (!current) {
      if (force) void backend.updateDiscordPresence(null);
      return;
    }
    const artwork =
      artworkRef.current?.trackId === current.id
        ? artworkRef.current.artwork
        : null;
    const previous = discordRef.current;
    const now = performance.now();
    const expected = previous.playing
      ? previous.position + (now - previous.at)
      : previous.position;
    const drifted =
      previous.trackId !== current.id || Math.abs(state.positionMs - expected) > 2500;
    if (!force && !drifted) return;

    discordRef.current = {
      trackId: current.id,
      position: state.positionMs,
      at: now,
      playing: state.isPlaying,
    };
    void backend.updateDiscordPresence({
      title: current.title,
      artist: current.artist,
      album: current.album,
      artwork,
      isPlaying: state.isPlaying,
      positionMs: state.positionMs,
      durationMs: state.durationMs || current.durationMs,
    });
  };

  // Native media keys / widget controls.
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const session = navigator.mediaSession;
    const actions: MediaSessionAction[] = [
      "play",
      "pause",
      "previoustrack",
      "nexttrack",
      "seekto",
      "seekbackward",
      "seekforward",
      "stop",
    ];
    const set = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        session.setActionHandler(action, handler);
      } catch {
        // Some actions are not implemented by every Chromium build.
      }
    };

    set("play", () => {
      const state = usePlayerStore.getState();
      if (!state.isPlaying) void state.togglePlay();
    });
    set("pause", () => {
      const state = usePlayerStore.getState();
      if (state.isPlaying) void state.togglePlay();
    });
    set("previoustrack", () => {
      void usePlayerStore.getState().prev();
    });
    set("nexttrack", () => {
      void usePlayerStore.getState().next();
    });
    set("seekto", (details) => {
      if (typeof details.seekTime === "number") {
        usePlayerStore.getState().seek(details.seekTime * 1000);
      }
    });
    set("seekbackward", (details) => {
      const state = usePlayerStore.getState();
      state.seek(state.positionMs - (details.seekOffset ?? 10) * 1000);
    });
    set("seekforward", (details) => {
      const state = usePlayerStore.getState();
      state.seek(state.positionMs + (details.seekOffset ?? 10) * 1000);
    });
    set("stop", () => {
      const state = usePlayerStore.getState();
      state.seek(0);
      if (state.isPlaying) void state.togglePlay();
    });

    return () => {
      for (const action of actions) set(action, null);
    };
  }, []);

  // Track metadata + artwork.
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const session = navigator.mediaSession;
    let cancelled = false;

    if (!track) {
      trackRef.current = null;
      artworkRef.current = null;
      session.metadata = null;
      session.playbackState = "none";
      sendDiscord(true);
      return;
    }

    const previousTrack = trackRef.current;
    trackRef.current = track;
    if (previousTrack?.coverPath !== track.coverPath) {
      artworkRef.current = null;
    } else if (artworkRef.current) {
      // Same cover file: keep it attached to the new track id.
      artworkRef.current = {
        trackId: track.id,
        artwork: artworkRef.current.artwork,
      };
    }
    const immediate = artworkRef.current?.artwork ?? null;
    session.metadata = metadataFor(track, immediate);

    void artworkDataUrl(track).then((artwork) => {
      if (cancelled) return;
      // The fetch can resolve after the user switched tracks but before this
      // effect's cleanup ran; never attach the old cover to the new track.
      const current = usePlayerStore.getState().currentTrack;
      if (!current || current.id !== track.id) return;
      artworkRef.current = { trackId: track.id, artwork };
      session.metadata = metadataFor(track, artwork);
      sendDiscord(true);
    });

    return () => {
      cancelled = true;
    };
    // sendDiscord only reads the latest store state; track drives this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track]);

  // Play/pause state + Discord status.
  useEffect(() => {
    if ("mediaSession" in navigator) {
      navigator.mediaSession.playbackState = track
        ? isPlaying
          ? "playing"
          : "paused"
        : "none";
    }
    if (track) sendDiscord(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.id, isPlaying]);

  // OS progress bar. Position lives outside React state: subscribing to the
  // 10 Hz store tick here used to re-render the whole App tree every 100 ms.
  useEffect(() => {
    if (!("mediaSession" in navigator) || !track || durationMs <= 0) return;
    const session = navigator.mediaSession;

    const update = (force: boolean) => {
      const state = usePlayerStore.getState();
      if (!state.currentTrack || state.durationMs <= 0) return;

      const now = performance.now();
      const last = positionStateRef.current;
      if (
        !force &&
        now - last.at < 1000 &&
        Math.abs(state.positionMs - last.position) < 1500
      ) {
        return;
      }

      const duration = state.durationMs / 1000;
      const position = Math.min(
        Math.max(0, state.positionMs / 1000),
        duration,
      );
      try {
        session.setPositionState({
          duration,
          playbackRate: 1,
          position,
        });
        positionStateRef.current = { at: now, position: state.positionMs };
      } catch {
        // Ignore invalid durations while a stream is still probing metadata.
      }

      // Catch seeks that happen while the track keeps playing.
      sendDiscord();
    };

    update(true);
    const interval = window.setInterval(() => update(false), 1000);
    const unsubscribe = usePlayerStore.subscribe((next, previous) => {
      if (Math.abs(next.positionMs - previous.positionMs) > 1500) {
        update(true);
      }
    });

    return () => {
      window.clearInterval(interval);
      unsubscribe();
    };
    // sendDiscord only reads the latest store state; track drives this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [durationMs, track?.id]);
}
