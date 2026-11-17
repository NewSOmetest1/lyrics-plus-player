import type {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  Session,
} from "electron";

export interface HiddenSpotifyWindowDeps {
  BrowserWindow: new (options: BrowserWindowConstructorOptions) => BrowserWindow;
  session: {
    defaultSession: Session;
    fromPartition(partition: string): Session;
  };
}

export interface HiddenSpotifyWindowLease {
  window: BrowserWindow;
  session: Session;
  timeoutMs: number;
  signal: AbortSignal;
}

export interface HiddenSpotifyWindowOptions {
  partition?: string;
  timeoutMs?: number;
}

export class HiddenWindowTimeoutError extends Error {}

export const DEFAULT_PARTITION: string;
export const MAX_TIMEOUT_MS: number;

export function withHiddenSpotifyWindow<T>(
  deps: HiddenSpotifyWindowDeps,
  options: HiddenSpotifyWindowOptions | undefined,
  task: (lease: HiddenSpotifyWindowLease) => Promise<T>,
): Promise<T>;

export function resetHiddenSpotifyWindow(): void;
