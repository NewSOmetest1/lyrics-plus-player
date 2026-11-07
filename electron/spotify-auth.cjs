/**
 * Native Electron Spotify token acquisition.
 *
 * `open.spotify.com/get_access_token` is protected by Cloudflare/TOTP and
 * rejects plain `fetch` requests with 403. Instead we:
 *   1. put the user's `sp_dc` cookie into the Electron session,
 *   2. open a hidden BrowserWindow on open.spotify.com,
 *   3. capture the first `Authorization: Bearer …` header the page sends,
 *   4. fall back to running the token request inside the page context,
 *   5. cache the token for 45 minutes.
 *
 * The module is plain CommonJS so the terminal test can run it under Electron
 * with the exact same implementation as the app.
 */

const CACHE_MS = 45 * 60 * 1000;
const TOKEN_URL =
  "https://open.spotify.com/get_access_token?reason=transport&productType=web_player";
const LOGIN_URL = "https://accounts.spotify.com/ru/login";
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const AUTH_POLL_MS = 700;
const AUTH_TIMEOUT_MS = 5 * 60 * 1000;

let cache = null;
let inflight = null;
let inflightToken = null;

function statusMessage(status) {
  switch (status) {
    case 401:
      return "401 Unauthorized — sp_dc is invalid or expired. Paste a fresh cookie.";
    case 403:
      return "403 Forbidden — expired cookie, region restriction, or Spotify Free account limit.";
    case 404:
      return "404 Not Found — Spotify has no lyrics for this track.";
    case 429:
      return "429 Too Many Requests — Spotify rate limit. Try again later.";
    default:
      return status ? `Spotify request failed with HTTP ${status}` : "Spotify did not return an access token.";
  }
}

async function installCookie(session, name, value) {
  if (!value) return;
  const expirationDate = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365;
  const common = {
    name,
    value,
    path: "/",
    secure: true,
    httpOnly: true,
    sameSite: "no_restriction",
    expirationDate,
  };
  try {
    await session.cookies.set({ ...common, domain: ".spotify.com" });
  } catch {
    // fall through to the URL-scoped cookie
  }
  try {
    await session.cookies.set({ ...common, url: "https://open.spotify.com" });
  } catch {
    // ignore — verification below reports the real failure
  }
}

/**
 * Read the two cookies Spotify's web player needs. `sp_dc` identifies the
 * account, while `sp_key` is its paired token; sending only one makes Spotify
 * reject the session on some accounts and regions.
 */
async function readSpotifyCookies(ses) {
  const cookies = await ses.cookies.get({});
  const pick = (name) =>
    cookies
      .filter((cookie) => cookie.name === name && cookie.value)
      .sort((a, b) => (b.expirationDate ?? 0) - (a.expirationDate ?? 0))[0]
      ?.value ?? "";
  return { spDc: pick("sp_dc"), spKey: pick("sp_key") };
}

function cookieHeader(spDc, spKey) {
  const parts = [];
  if (spDc) parts.push(`sp_dc=${spDc}`);
  if (spKey) parts.push(`sp_key=${spKey}`);
  return parts.join("; ");
}

function cookieRemovalUrl(cookie) {
  const domain = String(cookie.domain ?? "").replace(/^\./, "");
  const pathValue = cookie.path || "/";
  if (!domain) return null;
  return `https://${domain}${pathValue}`;
}

/**
 * Open a real Spotify login page in the shared Electron session. The user can
 * use their normal password, Google, Apple or magic-link login; we never touch
 * the credentials. As soon as both session cookies exist, they are persisted
 * and the window closes.
 *
 * @param {{
 *   BrowserWindow: any,
 *   session: any,
 *   parent?: any,
 * }} deps
 * @param {import("./store").LibraryStore} store
 * @param {(payload: { ok: boolean, spDc?: string, spKey?: string }) => void} [notify]
 */
async function loginSpotify(deps, store, notify) {
  const { BrowserWindow, session, parent } = deps;
  const ses = session.defaultSession;
  if (!BrowserWindow || !ses) {
    return { ok: false, cancelled: false, message: "Electron session is not available." };
  }

  let settled = false;
  let pollTimer = null;
  let timeoutTimer = null;
  let resolveAuth;
  const authPromise = new Promise((resolve) => {
    resolveAuth = resolve;
  });

  const finish = (result) => {
    if (settled) return;
    settled = true;
    if (pollTimer) clearInterval(pollTimer);
    if (timeoutTimer) clearTimeout(timeoutTimer);
    try {
      ses.cookies.removeListener("changed", onCookieChanged);
    } catch {
      // listener already removed
    }
    resolveAuth(result);
  };

  const checkCookies = async () => {
    if (settled) return;
    try {
      const { spDc, spKey } = await readSpotifyCookies(ses);
      if (!spDc || !spKey) return;
      store.setSetting("spotify_sp_dc", spDc);
      store.setSetting("spotify_sp_key", spKey);
      clearSpotifyTokenCache();
      finish({ ok: true, spDc, spKey });
      try {
        if (!authWin.isDestroyed()) authWin.close();
      } catch {
        // ignore close races
      }
      if (notify) {
        try {
          notify({ ok: true, spDc, spKey });
        } catch {
          // frontend may already be gone
        }
      }
    } catch (error) {
      debugAuth(
        "cookie check failed",
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  const onCookieChanged = () => {
    void checkCookies();
  };

  const authWin = new BrowserWindow({
    width: 500,
    height: 700,
    title: "Вход в Spotify",
    autoHideMenuBar: true,
    parent: parent && !parent.isDestroyed?.() ? parent : undefined,
    modal: Boolean(parent && !parent.isDestroyed?.()),
    backgroundColor: "#101014",
    webPreferences: {
      session: ses,
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  try {
    authWin.setMenuBarVisibility(false);
  } catch {
    // older Electron builds
  }
  try {
    authWin.webContents.setUserAgent(USER_AGENT);
  } catch {
    // optional
  }

  authWin.on("closed", () => {
    finish({ ok: false, cancelled: true, message: "Spotify login window was closed." });
  });

  ses.cookies.on("changed", onCookieChanged);
  pollTimer = setInterval(() => void checkCookies(), AUTH_POLL_MS);
  timeoutTimer = setTimeout(() => {
    finish({
      ok: false,
      cancelled: false,
      message: "Spotify login timed out after 5 minutes.",
    });
    try {
      if (!authWin.isDestroyed()) authWin.close();
    } catch {
      // ignore
    }
  }, AUTH_TIMEOUT_MS);

  try {
    await authWin.loadURL(LOGIN_URL);
  } catch (error) {
    debugAuth(
      "login page load failed",
      error instanceof Error ? error.message : String(error),
    );
  }

  // The page may already be authenticated in the shared session.
  void checkCookies();
  return authPromise;
}

async function logoutSpotify(deps) {
  const { session } = deps;
  const ses = session?.defaultSession;
  if (!ses) return { ok: false, message: "Electron session is not available." };
  try {
    const cookies = await ses.cookies.get({});
    for (const cookie of cookies) {
      if (cookie.name !== "sp_dc" && cookie.name !== "sp_key") continue;
      const url = cookieRemovalUrl(cookie);
      if (!url) continue;
      try {
        await ses.cookies.remove(url, cookie.name);
      } catch {
        // try the next duplicate
      }
    }
  } finally {
    clearSpotifyTokenCache();
  }
  return { ok: true };
}

function debugAuth(...args) {
  if (process.env.SPOTIFY_AUTH_DEBUG === "1") {
    console.log("[spotify-auth]", ...args);
  }
}

async function obtainToken(deps, spDc, spKey) {
  const { BrowserWindow, session } = deps;
  const ses = session.defaultSession;
  const startedAt = Date.now();
  const debug = (...args) => {
    if (process.env.SPOTIFY_AUTH_DEBUG === "1") {
      console.log("[spotify-auth]", `${Date.now() - startedAt}ms`, ...args);
    }
  };
  debug("start");

  await installCookie(ses, "sp_dc", spDc);
  await installCookie(ses, "sp_key", spKey);

  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    webPreferences: {
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  try {
    win.webContents.setUserAgent(USER_AGENT);
  } catch {
    // older Electron builds may not expose setUserAgent
  }

  let settled = false;
  let lastStatus = null;
  let resolveToken;
  const tokenPromise = new Promise((resolve) => {
    resolveToken = resolve;
  });

  const finish = (token, status) => {
    if (settled) return;
    if (token) {
      settled = true;
      resolveToken(token);
      return;
    }
    if (status) lastStatus = status;
  };

  const filter = {
    urls: ["https://api.spotify.com/*", "https://spclient.wg.spotify.com/*"],
  };
  const listener = (details) => {
    try {
      const headers = details?.requestHeaders || {};
      const auth =
        headers.Authorization ||
        headers.authorization ||
        headers.AUTHORIZATION ||
        "";
      const match = /^Bearer\s+(.+)$/i.exec(String(auth));
      if (match?.[1]) {
        debug("header bearer from", details.url);
        finish(match[1].trim(), null);
      }
    } catch (error) {
      // A webRequest listener must never throw: an uncaught exception would
      // surface as a native Electron error dialog and kill the main process.
      debug("header listener error", error instanceof Error ? error.message : String(error));
    }
  };

  ses.webRequest.onSendHeaders(filter, listener);

  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 20_000));

  try {
    // Do not await the full page load: open.spotify.com is heavy and the token
    // is usually available much earlier. Keep the navigation promise handled.
    void win.loadURL("https://open.spotify.com/").catch(() => undefined);
    debug("loadURL issued");
    win.webContents.once("dom-ready", () => debug("dom-ready"));

    const runInPage = () =>
      win.webContents.executeJavaScript(
        `(async () => {
          try {
            const response = await fetch(${JSON.stringify(TOKEN_URL)}, {
              credentials: "include",
              headers: { accept: "application/json" },
            });
            const text = await response.text();
            let payload = null;
            try { payload = JSON.parse(text); } catch {}
            return {
              status: response.status,
              token: payload && typeof payload.accessToken === "string" ? payload.accessToken : null,
            };
          } catch (error) {
            return { status: null, token: null, error: String(error) };
          }
        })()`,
        true,
      );

    // Ask the page to perform the token call as soon as the document exists.
    const pageAttempt = (async () => {
      await Promise.race([
        new Promise((resolve) => win.webContents.once("dom-ready", resolve)),
        new Promise((resolve) => setTimeout(resolve, 4_000)),
      ]);
      if (settled) return null;
      for (let attempt = 0; attempt < 3 && !settled; attempt += 1) {
        try {
          const result = await runInPage();
          debug("page fetch attempt", attempt + 1, "status", result?.status, "token", Boolean(result?.token));
          if (result?.token) {
            finish(result.token, null);
            return result.token;
          }
          if (result?.status) lastStatus = result.status;
        } catch {
          // page may still be navigating
        }
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
      return null;
    })();

    const token = await Promise.race([tokenPromise, pageAttempt, timeout]);
    if (token) {
      cache = { token, spDc, spKey, expiresAt: Date.now() + CACHE_MS };
      return { token, status: 200, message: "Token captured from Electron session." };
    }

    // Last chance: inspect the session cookie jar without throwing.
    try {
      const cookies = await ses.cookies.get({});
      const hasCookie = (name, value) =>
        cookies.some((cookie) => cookie.name === name && cookie.value === value);
      if (!hasCookie("sp_dc", spDc) || !hasCookie("sp_key", spKey)) {
        return {
          token: null,
          status: lastStatus ?? 401,
          message: "sp_dc/sp_key cookies were rejected by the Electron session.",
        };
      }
    } catch {
      // ignore
    }

    return {
      token: null,
      status: lastStatus ?? 403,
      message: statusMessage(lastStatus ?? 403),
    };
  } catch (error) {
    return {
      token: null,
      status: lastStatus ?? null,
      message: `Electron auth window failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    try {
      ses.webRequest.onSendHeaders(null);
    } catch {
      // listener already removed
    }
    try {
      if (!win.isDestroyed()) win.destroy();
    } catch {
      // ignore destroy races
    }
  }
}

/**
 * @param {{ BrowserWindow: any, session: any }} deps Electron modules.
 * @param {string} spDc
 * @param {string} spKey
 * @param {boolean} [force]
 * @returns {Promise<{ token: string | null, status: number | null, message?: string, cached?: boolean }>}
 */
async function getSpotifyAccessToken(deps, spDc, spKey, force = false) {
  if (!spDc || !spKey) {
    return {
      token: null,
      status: null,
      message: "sp_dc and sp_key cookies are both required",
    };
  }
  const cacheKey = `${spDc}\u0000${spKey}`;
  if (!force && cache && cache.spDc === spDc && cache.spKey === spKey && Date.now() < cache.expiresAt) {
    return { token: cache.token, status: 200, message: "Cached token.", cached: true };
  }
  if (inflight && inflightToken === cacheKey) return inflight;

  inflightToken = cacheKey;
  inflight = obtainToken(deps, spDc, spKey).finally(() => {
    inflight = null;
    inflightToken = null;
  });
  return inflight;
}

function clearSpotifyTokenCache() {
  cache = null;
}

/**
 * Resolve track IDs through the web player's own search page.
 *
 * The public Web API (`api.spotify.com/v1/search`) can answer 429 for long
 * periods, especially for web-player tokens. The open.spotify.com search page
 * uses Spotify's partner API with the same sp_dc session, so it keeps working
 * while the public API is throttled. We scrape only the rendered track rows.
 *
 * @param {{ BrowserWindow: any, session: any }} deps
 * @param {string} spDc
 * @param {string} spKey
 * @param {string} query
 * @param {number} [timeoutMs]
 * @returns {Promise<Array<{ id: string, title: string, artist: string }>>}
 */
async function searchSpotifyTracksViaWeb(deps, spDc, spKey, query, timeoutMs = 12_000) {
  if (!spDc || !spKey || !query) return [];
  const { BrowserWindow, session } = deps;
  const ses = session.defaultSession;
  await installCookie(ses, "sp_dc", spDc);
  await installCookie(ses, "sp_key", spKey);

  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: {
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  try {
    win.webContents.setUserAgent(USER_AGENT);
  } catch {
    // older Electron builds may not expose setUserAgent
  }

  const scrape = `(() => {
    const out = [];
    for (const anchor of document.querySelectorAll('a[href*="/track/"]')) {
      const href = anchor.getAttribute("href") || "";
      const id = (href.split("/track/")[1] || "").split(/[?#]/)[0];
      if (!id) continue;
      const row =
        anchor.closest('[role="row"]') ||
        anchor.closest('[data-testid="tracklist-row"]') ||
        anchor.parentElement?.parentElement;
      const title =
        row?.querySelector('[data-testid="title"]')?.innerText?.trim() ||
        anchor.innerText?.trim() ||
        "";
      const subtitle = row?.querySelector('[data-testid="subtitle"]');
      const artist =
        subtitle?.querySelector('a[href*="/artist/"]')?.innerText?.trim() ||
        "";
      if (!out.some((entry) => entry.id === id)) out.push({ id, title, artist });
    }
    return out;
  })()`;

  const startedAt = Date.now();
  try {
    void win
      .loadURL(`https://open.spotify.com/search/${encodeURIComponent(query)}`)
      .catch(() => undefined);

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      let rows = [];
      try {
        rows = await win.webContents.executeJavaScript(scrape, true);
      } catch {
        rows = [];
      }
      if (Array.isArray(rows) && rows.length > 0) {
        debugSearch(`web search "${query}" found ${rows.length} row(s) in ${Date.now() - startedAt}ms`);
        return rows;
      }
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
    debugSearch(`web search "${query}" timed out after ${Date.now() - startedAt}ms`);
    return [];
  } catch (error) {
    debugSearch(`web search failed: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  } finally {
    try {
      if (!win.isDestroyed()) win.destroy();
    } catch {
      // ignore destroy races
    }
  }
}

function debugSearch(...args) {
  if (process.env.SPOTIFY_AUTH_DEBUG === "1") {
    console.log("[spotify-auth]", ...args);
  }
}

module.exports = {
  getSpotifyAccessToken,
  clearSpotifyTokenCache,
  searchSpotifyTracksViaWeb,
  statusMessage,
  readSpotifyCookies,
  cookieHeader,
  loginSpotify,
  logoutSpotify,
};
