/**
 * Shared hidden BrowserWindow for Spotify web-session work.
 *
 * Token capture, web search and partner-header warmup all need a real
 * Electron page. Creating a window per call lets concurrent requests fan out
 * into dozens of renderer processes, so this module keeps one window alive and
 * serialises those jobs through a promise queue.
 *
 * A job that does not settle within 15 seconds is aborted, its window is
 * destroyed, and the next queued job starts with a fresh window. The window is
 * also discarded after a short idle period instead of keeping a Spotify page
 * running in the background forever.
 */

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 15_000;
const IDLE_DESTROY_MS = 30_000;
const DEFAULT_PARTITION = "lyrics-plus-spotify-releases";
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

class HiddenWindowTimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = "HiddenWindowTimeoutError";
  }
}

let hiddenWindow = null;
let hiddenPartition = null;
let queueTail = Promise.resolve();
let pending = 0;
let idleTimer = null;

function clearIdleTimer() {
  if (!idleTimer) return;
  clearTimeout(idleTimer);
  idleTimer = null;
}

function isAlive(win) {
  if (!win || win.isDestroyed()) return false;
  try {
    return !win.webContents.isDestroyed();
  } catch {
    return false;
  }
}

function destroyWindow(target = hiddenWindow) {
  if (!target) return;
  if (hiddenWindow === target) {
    hiddenWindow = null;
    hiddenPartition = null;
    clearIdleTimer();
  }
  try {
    if (!target.isDestroyed()) target.destroy();
  } catch {
    // Ignore destroy races.
  }
}

function scheduleIdleDestroy() {
  clearIdleTimer();
  if (pending > 0) return;
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (pending === 0) destroyWindow();
  }, IDLE_DESTROY_MS);
  if (typeof idleTimer.unref === "function") idleTimer.unref();
}

function createWindow(deps, partition) {
  const win = new deps.BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: {
      partition,
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  try {
    win.webContents.setUserAgent(USER_AGENT);
  } catch {
    // Older Electron builds may not expose setUserAgent.
  }
  try {
    // A hidden Spotify page must never leak audio into the player.
    win.webContents.setAudioMuted(true);
  } catch {
    // Older Electron builds may not expose setAudioMuted.
  }
  win.on("closed", () => {
    if (hiddenWindow !== win) return;
    hiddenWindow = null;
    hiddenPartition = null;
    clearIdleTimer();
  });
  try {
    win.webContents.on("render-process-gone", () => {
      if (hiddenWindow === win) destroyWindow(win);
    });
  } catch {
    // Ignore listener registration races.
  }
  return win;
}

function ensureWindow(deps, partition) {
  if (isAlive(hiddenWindow) && hiddenPartition === partition) {
    return hiddenWindow;
  }
  destroyWindow();
  hiddenWindow = createWindow(deps, partition);
  hiddenPartition = partition;
  return hiddenWindow;
}

function withTimeout(promise, ms, message) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new HiddenWindowTimeoutError(message)),
      Math.max(1, ms),
    );
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function blankPage(win) {
  if (!isAlive(win)) return;
  try {
    await withTimeout(
      win.loadURL("about:blank"),
      2_000,
      "Spotify hidden window did not unload in time.",
    );
  } catch {
    destroyWindow(win);
  }
}

function enqueue(run) {
  pending += 1;
  clearIdleTimer();
  const task = queueTail.then(run, run);
  queueTail = task.then(
    () => undefined,
    () => undefined,
  );
  return task.finally(() => {
    pending -= 1;
    if (pending === 0) scheduleIdleDestroy();
  });
}

/**
 * Run one job in the shared hidden Spotify window.
 *
 * @template T
 * @param {{ BrowserWindow: any, session: any }} deps
 * @param {{ partition?: string, timeoutMs?: number }} [options]
 * @param {(lease: {
 *   window: any,
 *   session: any,
 *   timeoutMs: number,
 *   signal: AbortSignal,
 * }) => Promise<T>} task
 * @returns {Promise<T>}
 */
function withHiddenSpotifyWindow(deps, options, task) {
  const partition = options?.partition || DEFAULT_PARTITION;
  const timeoutMs = Math.min(
    Math.max(1, options?.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    MAX_TIMEOUT_MS,
  );

  return enqueue(async () => {
    const win = ensureWindow(deps, partition);
    const session = win.webContents.session;
    const controller = new AbortController();
    let timer = null;
    let timedOut = false;

    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        console.warn(
          `[spotify-window] job timed out after ${timeoutMs}ms; destroying the hidden window.`,
        );
        destroyWindow(win);
        reject(
          new HiddenWindowTimeoutError(
            `Spotify hidden window job timed out after ${timeoutMs}ms.`,
          ),
        );
      }, timeoutMs);
    });

    let result;
    try {
      result = await Promise.race([
        Promise.resolve().then(() =>
          task({
            window: win,
            session,
            timeoutMs,
            signal: controller.signal,
          }),
        ),
        timeout,
      ]);
    } catch (error) {
      if (timer) clearTimeout(timer);
      if (!timedOut) destroyWindow(win);
      throw error;
    }

    // The job is done: stop the Spotify page before keeping the window for a
    // follow-up job. Cleanup has its own short timeout and must not count
    // against the job's 15 second budget.
    if (timer) clearTimeout(timer);
    await blankPage(win);
    return result;
  });
}

/** Drop the shared window, e.g. after logout or a credential change. */
function resetHiddenSpotifyWindow() {
  destroyWindow();
}

module.exports = {
  DEFAULT_PARTITION,
  MAX_TIMEOUT_MS,
  HiddenWindowTimeoutError,
  withHiddenSpotifyWindow,
  resetHiddenSpotifyWindow,
};
