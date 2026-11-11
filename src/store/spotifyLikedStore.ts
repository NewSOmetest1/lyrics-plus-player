import { create } from "zustand";

import { backend } from "@/lib/api";
import {
  isSpotifyId,
  normalizeTrackPath,
  spotifyIdFromUrl,
} from "@/lib/trackPath";
import type {
  SpotifyLikedSnapshot,
  SpotifyLikedTrack,
  SpotifyLikedTrackInput,
} from "@/types";
import { useToastStore } from "@/store/toastStore";

const LIKE_DEBOUNCE_MS = 350;

interface OptimisticLike {
  liked: boolean;
  item: SpotifyLikedTrack | null;
  /** Real Spotify id when known; null for a local-only optimistic row. */
  id: string | null;
  localPath: string | null;
  input: SpotifyLikedTrackInput | null;
  updatedAt: number;
}

interface MergedView {
  snapshot: SpotifyLikedSnapshot | null;
  likedPaths: Set<string>;
  knownIds: Map<string, string>;
  likedIds: Set<string>;
}

interface SpotifyLikedState extends MergedView {
  /** Last snapshot confirmed by the main process. */
  base: SpotifyLikedSnapshot | null;
  optimistic: Record<string, OptimisticLike>;
  loaded: boolean;
  syncing: boolean;

  init: () => Promise<void>;
  refresh: () => Promise<SpotifyLikedSnapshot | null>;
  sync: (silent?: boolean) => Promise<SpotifyLikedSnapshot | null>;
  /** Apply a heart change to the visible snapshot synchronously. */
  applyOptimistic: (request: LikeRequest) => string;
  /** Coalesce one track's network writes and resolve when it settles. */
  requestNetwork: (key: string, request: LikeRequest) => Promise<boolean>;
  itemForPath: (trackPath: string | null | undefined) => SpotifyLikedTrack | null;
  knownIdForPath: (trackPath: string | null | undefined) => string | null;
}

export interface LikeRequest {
  trackId: string;
  liked: boolean;
  input: SpotifyLikedTrackInput | null;
  localPath?: string | null;
}

interface NetworkBatch {
  key: string;
  trackId: string;
  input: SpotifyLikedTrackInput | null;
  desired: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  inFlight: boolean;
  waiters: Array<(ok: boolean) => void>;
}

const batches = new Map<string, NetworkBatch>();

function emptySnapshot(): SpotifyLikedSnapshot {
  return {
    version: 1,
    items: [],
    total: 0,
    downloaded: 0,
    missing: 0,
    fetchedAt: null,
    source: null,
    warnings: [],
    authenticated: false,
  };
}

function realTrackId(
  trackId: string | null | undefined,
  input: SpotifyLikedTrackInput | null,
): string | null {
  const value = trackId?.trim() ?? "";
  if (isSpotifyId(value)) return value;
  return spotifyIdFromUrl(input?.spotifyUrl ?? null);
}

/** Stable batching key shared by the renderer and the visible override map. */
export function spotifyLikeKey(
  trackId: string | null | undefined,
  localPath: string | null | undefined,
  input: SpotifyLikedTrackInput | null,
): string {
  const path = localPath?.trim();
  if (path) return `path:${normalizeTrackPath(path)}`;
  const id = realTrackId(trackId, input);
  if (id) return `id:${id}`;
  const title = input?.title?.trim().toLocaleLowerCase() ?? "";
  const artist = input?.artist?.trim().toLocaleLowerCase() ?? "";
  return `meta:${title}\u0000${artist}`;
}

function matches(
  item: SpotifyLikedTrack,
  id: string | null,
  localPath: string | null,
): boolean {
  if (id && item.id === id) return true;
  if (
    localPath &&
    item.localPath &&
    normalizeTrackPath(item.localPath) === localPath
  ) {
    return true;
  }
  return false;
}

function buildOptimisticItem(
  key: string,
  request: LikeRequest,
  existing: SpotifyLikedTrack | null,
): SpotifyLikedTrack {
  const path = request.localPath?.trim() || existing?.localPath || null;
  const id =
    realTrackId(request.trackId, request.input) ??
    (existing && isSpotifyId(existing.id) ? existing.id : null) ??
    `local:${key}`;
  const input = request.input;
  return {
    id,
    title: input?.title?.trim() || existing?.title || "",
    artist: input?.artist?.trim() || existing?.artist || "",
    album: input?.album?.trim() || existing?.album || "",
    durationMs:
      input?.durationMs && input.durationMs > 0
        ? input.durationMs
        : (existing?.durationMs ?? 0),
    coverUrl: input?.coverUrl ?? existing?.coverUrl ?? null,
    spotifyUrl:
      input?.spotifyUrl?.trim() ||
      existing?.spotifyUrl ||
      (isSpotifyId(id) ? `https://open.spotify.com/track/${id}` : ""),
    addedAt: existing?.addedAt ?? Date.now(),
    isDownloaded: Boolean(path) || Boolean(existing?.isDownloaded),
    localPath: path,
  };
}

function buildView(
  base: SpotifyLikedSnapshot | null,
  optimistic: Record<string, OptimisticLike>,
): MergedView {
  const operations = Object.entries(optimistic);
  const baseItems = base?.items ?? [];
  const items: SpotifyLikedTrack[] = [];

  for (const item of baseItems) {
    const superseded = operations.some(([, operation]) =>
      matches(item, operation.id, operation.localPath),
    );
    if (!superseded) items.push(item);
  }

  const additions = operations
    .filter(([, operation]) => operation.liked && operation.item)
    .map(([, operation]) => operation.item as SpotifyLikedTrack)
    .sort((a, b) => b.addedAt - a.addedAt);
  items.unshift(...additions);

  const likedPaths = new Set<string>();
  const knownIds = new Map<string, string>();
  const likedIds = new Set<string>();
  for (const item of items) {
    if (isSpotifyId(item.id)) likedIds.add(item.id);
    if (!item.localPath) continue;
    const path = normalizeTrackPath(item.localPath);
    likedPaths.add(path);
    if (isSpotifyId(item.id)) knownIds.set(path, item.id);
  }

  const snapshot = base
    ? {
        ...base,
        items,
        total: Math.max(0, base.total + (items.length - baseItems.length)),
        downloaded: items.filter((item) => item.isDownloaded).length,
        missing: items.filter((item) => !item.isDownloaded).length,
      }
    : items.length > 0
      ? {
          ...emptySnapshot(),
          items,
          total: items.length,
          downloaded: items.filter((item) => item.isDownloaded).length,
          missing: items.filter((item) => !item.isDownloaded).length,
        }
      : null;

  return { snapshot, likedPaths, knownIds, likedIds };
}

function pushLikeError(error: unknown, input: SpotifyLikedTrackInput | null): void {
  const raw = error instanceof Error ? error.message : String(error);
  const matchFailure = raw.startsWith("Could not match");
  useToastStore.getState().push({
    kind: "error",
    title: matchFailure ? "Could not match Spotify ID" : "Spotify Like Error",
    description: matchFailure
      ? (input?.title ?? raw)
      : raw.replace(/^Spotify Like Error:\s*/, "") ||
        input?.title ||
        "Spotify rejected the change.",
  });
}

function finishBatch(batch: NetworkBatch, ok: boolean): void {
  batches.delete(batch.key);
  const waiters = batch.waiters.splice(0);
  for (const resolve of waiters) resolve(ok);
}

function schedule(batch: NetworkBatch, delay = LIKE_DEBOUNCE_MS): void {
  if (batch.timer !== null) clearTimeout(batch.timer);
  batch.timer = setTimeout(() => {
    batch.timer = null;
    void flushBatch(batch);
  }, delay);
}

async function flushBatch(batch: NetworkBatch): Promise<void> {
  if (batch.inFlight) return;
  batch.inFlight = true;
  const desired = batch.desired;
  const trackId = batch.trackId;
  const input = batch.input;

  try {
    const snapshot = await backend.setSpotifyLiked(trackId, desired, input);
    const final = batch.desired === desired;
    batch.inFlight = false;
    useSpotifyLikedStore.setState((state) => {
      const optimistic = { ...state.optimistic };
      if (final) delete optimistic[batch.key];
      return {
        base: snapshot,
        optimistic,
        ...buildView(snapshot, optimistic),
      };
    });
    if (final) finishBatch(batch, true);
    else schedule(batch, 0);
  } catch (error) {
    batch.inFlight = false;
    // The user changed their mind while this request was in flight. Keep the
    // optimistic UI and send only the latest desired state.
    if (batch.desired !== desired) {
      schedule(batch, 0);
      return;
    }
    useSpotifyLikedStore.setState((state) => {
      const optimistic = { ...state.optimistic };
      delete optimistic[batch.key];
      return { optimistic, ...buildView(state.base, optimistic) };
    });
    pushLikeError(error, input);
    finishBatch(batch, false);
  }
}

/**
 * Send every pending per-track like immediately and wait (bounded) for the
 * API to settle. The main process asks for this during window close so the
 * last heart change cannot be lost inside the debounce window.
 */
export async function flushPendingLikes(timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (batches.size > 0 && Date.now() < deadline) {
    const waits: Promise<boolean>[] = [];
    for (const batch of [...batches.values()]) {
      if (batch.timer !== null) {
        clearTimeout(batch.timer);
        batch.timer = null;
      }
      waits.push(
        new Promise<boolean>((resolve) => batch.waiters.push(resolve)),
      );
      if (!batch.inFlight) void flushBatch(batch);
    }
    if (waits.length === 0) break;
    await Promise.race([
      Promise.all(waits),
      new Promise<void>((resolve) =>
        setTimeout(
          resolve,
          Math.max(0, Math.min(250, deadline - Date.now())),
        ),
      ),
    ]);
  }
}

export const useSpotifyLikedStore = create<SpotifyLikedState>((set, get) => ({
  base: null,
  snapshot: null,
  optimistic: {},
  likedPaths: new Set<string>(),
  knownIds: new Map<string, string>(),
  likedIds: new Set<string>(),
  loaded: false,
  syncing: false,

  init: async () => {
    try {
      const snapshot = await backend.getSpotifyLiked();
      set((state) => ({
        base: snapshot,
        loaded: true,
        ...buildView(snapshot, state.optimistic),
      }));
    } catch (error) {
      console.warn("[spotify-liked] initial load failed:", error);
      set({ loaded: true });
    }
  },

  refresh: async () => {
    try {
      const snapshot = await backend.getSpotifyLiked();
      set((state) => ({
        base: snapshot,
        loaded: true,
        ...buildView(snapshot, state.optimistic),
      }));
      return snapshot;
    } catch (error) {
      console.warn("[spotify-liked] refresh failed:", error);
      return null;
    }
  },

  sync: async (silent = false) => {
    if (get().syncing) return null;
    set({ syncing: true });
    try {
      const snapshot = await backend.syncSpotifyLiked();
      set((state) => ({
        base: snapshot,
        loaded: true,
        syncing: false,
        ...buildView(snapshot, state.optimistic),
      }));
      if (!silent) {
        useToastStore.getState().push({
          kind: "success",
          title: "Spotify Liked Songs synced",
          description: `${snapshot.total} tracks · ${snapshot.downloaded} downloaded · ${snapshot.missing} missing`,
        });
      }
      return snapshot;
    } catch (error) {
      set({ syncing: false });
      if (silent) {
        console.warn("[spotify-liked] background sync failed:", error);
      } else {
        useToastStore.getState().push({
          kind: "error",
          title: "Spotify sync failed",
          description: error instanceof Error ? error.message : String(error),
        });
      }
      return null;
    }
  },

  applyOptimistic: (request) => {
    const key = spotifyLikeKey(request.trackId, request.localPath, request.input);
    set((state) => {
      const previous = state.optimistic[key];
      const existing =
        state.snapshot?.items.find((item) =>
          matches(
            item,
            realTrackId(request.trackId, request.input) ?? previous?.id ?? null,
            request.localPath?.trim()
              ? normalizeTrackPath(request.localPath)
              : null,
          ),
        ) ?? previous?.item ?? null;
      const optimistic: Record<string, OptimisticLike> = {
        ...state.optimistic,
        [key]: {
          liked: request.liked,
          item: request.liked
            ? buildOptimisticItem(key, request, existing)
            : null,
          id: realTrackId(request.trackId, request.input) ?? previous?.id ?? null,
          localPath: request.localPath?.trim()
            ? normalizeTrackPath(request.localPath)
            : (previous?.localPath ?? null),
          input: request.input,
          updatedAt: Date.now(),
        },
      };
      return { optimistic, ...buildView(state.base, optimistic) };
    });
    return key;
  },

  requestNetwork: (key, request) => {
    const id = realTrackId(request.trackId, request.input);
    const realId = id ?? "";
    let batch = batches.get(key);
    if (!batch) {
      batch = {
        key,
        trackId: realId,
        input: request.input,
        desired: request.liked,
        timer: null,
        inFlight: false,
        waiters: [],
      };
      batches.set(key, batch);
    } else {
      if (realId) batch.trackId = realId;
      if (request.input) batch.input = request.input;
      batch.desired = request.liked;
    }

    const promise = new Promise<boolean>((resolve) => {
      batch!.waiters.push(resolve);
    });
    if (batch.timer === null && !batch.inFlight) schedule(batch);
    return promise;
  },

  itemForPath: (trackPath) => {
    if (!trackPath) return null;
    const path = normalizeTrackPath(trackPath);
    return (
      get().snapshot?.items.find(
        (item) => item.localPath && normalizeTrackPath(item.localPath) === path,
      ) ?? null
    );
  },

  knownIdForPath: (trackPath) => {
    if (!trackPath) return null;
    return get().knownIds.get(normalizeTrackPath(trackPath)) ?? null;
  },
}));
