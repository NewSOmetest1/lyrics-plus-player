#!/usr/bin/env node
/**
 * Full-stream resolver test for Lyrics+.
 *
 * Usage:
 *   npm run test:youtube
 *
 * Two layers:
 *  - deterministic ranking/variant/URL fixtures (no network)
 *  - one live `resolveFullStream` through the real Electron main-process
 *    pipeline, with a per-yt-dlp-call timing breakdown
 *
 * Runs inside Electron because `electron/mediaProbe.ts` uses `electron.net`.
 * `electron/preview.ts` is bundled to CJS first (extensionless imports do not
 * resolve in Node ESM), so the script must be run after the esbuild step.
 */

const path = require("node:path");
const childProcess = require("node:child_process");
const util = require("node:util");
const { app } = require("electron");

const ROOT = path.resolve(__dirname, "..");
const BUNDLE = path.join(
  ROOT,
  "node_modules/.cache/lyrics-plus/preview.test.cjs",
);

const color = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
};

function paint(value, style) {
  return `${color[style]}${value}${color.reset}`;
}

let failures = 0;

function check(name, condition, detail = "") {
  if (condition) {
    console.log(
      `  ${paint("PASS", "green")} ${name}${detail ? paint(`  ${detail}`, "dim") : ""}`,
    );
    return true;
  }
  failures += 1;
  console.log(
    `  ${paint("FAIL", "red")} ${name}${detail ? paint(`  ${detail}`, "dim") : ""}`,
  );
  return false;
}

/* ------------------------------------------------------------------ *
 * Timing wrapper around execFile.
 *
 * Patch before requiring the bundle: preview.ts calls promisify(execFile)
 * at module load, so a later patch would not be observed.
 * ------------------------------------------------------------------ */

const ytDlpCalls = [];
const originalExecFile = childProcess.execFile;

function patchedExecFile(file, args, options, callback) {
  if (typeof options === "function") {
    callback = options;
    options = undefined;
  }
  const startedAt = performance.now();
  const record = {
    command: String(file),
    args: Array.isArray(args) ? args.map(String) : [],
    startedAt,
    ms: 0,
    ok: false,
    url: "",
    target: "",
    error: "",
  };
  record.target =
    record.args.find(
      (arg) =>
        arg.startsWith("ytsearch") ||
        arg.startsWith("scsearch") ||
        /^https?:\/\//.test(arg),
    ) ?? record.args[record.args.length - 1] ?? "";
  ytDlpCalls.push(record);

  return originalExecFile.call(
    this,
    file,
    args,
    options,
    (error, stdout, stderr) => {
      record.ms = Math.round(performance.now() - startedAt);
      record.ok = !error;
      record.url =
        String(stdout ?? "")
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find((line) => line.startsWith("https://")) ?? "";
      try {
        const text = String(stdout ?? "");
        record.stdoutBytes = text.length;
        const parsed = JSON.parse(text);
        record.entries = Array.isArray(parsed?.entries)
          ? parsed.entries.length
          : -1;
        if (Array.isArray(parsed?.entries)) {
          record.titles = parsed.entries
            .slice(0, 4)
            .map((entry) => String(entry?.title ?? ""));
        }
      } catch {
        record.entries = -2;
      }
      if (record.url) {
        try {
          record.host = new URL(record.url).hostname;
        } catch {
          record.host = "invalid-url";
        }
      }
      if (error) {
        record.error = String(error.message ?? error)
          .split(/\r?\n/)[0]
          .slice(0, 120);
      }
      callback(error, stdout, stderr);
    },
  );
}

/*
 * Node gives child_process.execFile a custom promisify that resolves with
 * { stdout, stderr }. A bare wrapper function loses that symbol, so
 * preview.ts's `promisify(execFile)` would resolve with only the first
 * callback argument and every JSON search would look empty. Mirror the
 * built-in contract.
 */
patchedExecFile[util.promisify.custom] = function promisifiedExecFile(
  file,
  args,
  options,
) {
  return new Promise((resolve, reject) => {
    patchedExecFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
};

childProcess.execFile = patchedExecFile;

let preview;
try {
  preview = require(BUNDLE);
} catch (error) {
  console.error(
    paint(`Cannot load ${BUNDLE}\n${error?.stack ?? error}`, "red"),
  );
  process.exit(1);
}

const {
  resolveFullStream,
  previewTestUtils: utils,
} = preview;

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

function runFixtures() {
  console.log(paint("\nFixtures", "bold"));

  const track = {
    title: "Blinding Lights",
    artist: "The Weeknd",
    durationMs: 200_000,
  };

  const ranked = utils.rankYoutubeEntries(
    [
      {
        id: "official-video",
        title: "The Weeknd - Blinding Lights (Official Video)",
        duration: 263,
        channel: "The Weeknd",
      },
      {
        id: "topic-audio",
        title: "Blinding Lights",
        duration: 200,
        channel: "The Weeknd - Topic",
      },
      {
        id: "lyrics-repost",
        title: "The Weeknd - Blinding Lights (Lyrics)",
        duration: 200,
        channel: "7clouds",
      },
    ],
    track,
  );
  check(
    "official Topic audio outranks video/reposts",
    ranked[0]?.id === "topic-audio",
    `top=${ranked[0]?.id ?? "none"}`,
  );

  const variants = utils.rankYoutubeEntries(
    [
      {
        id: "live",
        title: "The Weeknd - Blinding Lights (Live On The 2020 MTV VMAs)",
        duration: 199,
        channel: "The Weeknd",
      },
      {
        id: "instrumental",
        title: "The Weeknd - Blinding Lights (Instrumental)",
        duration: 200,
        channel: "The Weeknd",
      },
    ],
    track,
  );
  check(
    "rejects unrequested live/instrumental results",
    variants.length === 0,
    `kept=${variants.length}`,
  );

  const mismatch = utils.rankYoutubeEntries(
    [
      {
        id: "album-upload",
        title: "The Weeknd - Blinding Lights",
        duration: 500,
        channel: "The Weeknd",
      },
    ],
    track,
  );
  check(
    "rejects >90 s duration mismatch",
    mismatch.length === 0,
    `kept=${mismatch.length}`,
  );

  const remix = utils.rankYoutubeEntries(
    [
      {
        id: "remix",
        title: "The Weeknd - Blinding Lights (Remix)",
        duration: 200,
        channel: "The Weeknd",
      },
    ],
    {
      title: "Blinding Lights (Remix)",
      artist: "The Weeknd",
      durationMs: 200_000,
    },
  );
  check(
    "keeps an explicitly requested remix",
    remix.length === 1 && remix[0]?.id === "remix",
    `kept=${remix.map((entry) => entry.id).join(",") || "none"}`,
  );

  check(
    "variant filter sees raw titles, not stripped keys",
    utils.addsUnrequestedVariant(
      "Blinding Lights (Live)",
      "Blinding Lights",
    ) === true &&
      utils.addsUnrequestedVariant("Blinding Lights", "Blinding Lights") ===
        false,
  );

  check(
    "rejects HLS manifest URLs",
    utils.directHttps(
      "https://manifest.googlevideo.com/api/manifest/hls_variant/abc",
    ) === null &&
      utils.directHttps("https://cdn.example.com/audio.m3u8") === null,
  );
  check(
    "accepts progressive googlevideo URLs",
    utils.directHttps(
      "https://rr3---sn-4g5e6nsz.googlevideo.com/videoplayback?id=abc",
    )?.startsWith("https://rr3---") === true,
  );

  const soundcloud = utils.rankSoundcloudEntries(
    [
      {
        id: "preview",
        title: "Blinding Lights",
        duration: 30,
        uploader: "The Weeknd",
      },
      {
        id: "full",
        title: "Blinding Lights",
        duration: 181,
        uploader: "The Weeknd",
      },
    ],
    { title: "Blinding Lights", artist: "The Weeknd", durationMs: 180_000 },
  );
  check(
    "SoundCloud rejects a 30 s preview for a 3 min track",
    soundcloud.length === 1 && soundcloud[0]?.id === "full",
    `kept=${soundcloud.map((entry) => entry.id).join(",") || "none"}`,
  );
}

/* ------------------------------------------------------------------ *
 * Direct search + cache
 * ------------------------------------------------------------------ */

async function runDirectSearch() {
  console.log(paint("\nDirect search", "bold"));

  const callsBefore = ytDlpCalls.length;
  const startedAt = performance.now();
  let direct = null;
  let error = null;
  try {
    direct = await utils.searchYoutube("Daft Punk Get Lucky", 6);
  } catch (caught) {
    error = caught;
  }
  const directMs = Math.round(performance.now() - startedAt);
  const spawned = ytDlpCalls.length - callsBefore;

  check(
    "Innertube search returns results",
    Array.isArray(direct) && direct.length > 0,
    error
      ? String(error.message ?? error)
      : `${direct?.length ?? 0} entries in ${directMs} ms`,
  );
  check(
    "direct search spawns no yt-dlp",
    spawned === 0,
    `${spawned} calls`,
  );
  if (direct?.length) {
    check(
      "entries carry id, title and watch URL",
      direct.every(
        (entry) =>
          typeof entry.id === "string" &&
          entry.id.length > 0 &&
          entry.title.length > 0 &&
          entry.url.includes(entry.id),
      ),
      direct
        .slice(0, 3)
        .map((entry) => entry.title)
        .join(" | "),
    );
  }

  const firstStartedAt = performance.now();
  const first = await utils.searchEntries("Daft Punk Get Lucky");
  const firstMs = Math.round(performance.now() - firstStartedAt);
  const firstSpawned = ytDlpCalls.length - callsBefore - spawned;
  check(
    "cached search path returns entries without yt-dlp",
    first.length > 0 && firstSpawned === 0,
    `${first.length} entries in ${firstMs} ms`,
  );

  const cacheStartedAt = performance.now();
  const cached = await utils.searchEntries("Daft Punk Get Lucky");
  const cacheMs = Math.round(performance.now() - cacheStartedAt);
  check(
    "search cache answers in under 50 ms",
    cached.length === first.length && cacheMs < 50,
    `${cacheMs} ms`,
  );
}

/* ------------------------------------------------------------------ *
 * Fallback contract
 * ------------------------------------------------------------------ */

async function runFallback() {
  console.log(paint("\nFallback contract", "bold"));

  const originalFetch = globalThis.fetch;
  let blocked = 0;
  globalThis.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.includes("/youtubei/v1/search")) {
      blocked += 1;
      return Promise.reject(new Error("blocked by test"));
    }
    return originalFetch(input, init);
  };

  const callsBefore = ytDlpCalls.length;
  let entries = [];
  let error = null;
  try {
    entries = await utils.searchEntries("Daft Punk One More Time");
  } catch (caught) {
    error = caught;
  } finally {
    globalThis.fetch = originalFetch;
  }
  const spawned = ytDlpCalls.length - callsBefore;

  check(
    "failed Innertube search falls back to yt-dlp",
    blocked > 0 && spawned > 0 && entries.length > 0,
    error
      ? String(error.message ?? error)
      : `blocked=${blocked} yt-dlp=${spawned} entries=${entries.length}`,
  );
}

/* ------------------------------------------------------------------ *
 * Live resolve
 * ------------------------------------------------------------------ */

function printCalls() {
  console.log(paint("\nyt-dlp calls", "bold"));
  if (ytDlpCalls.length === 0) {
    console.log(paint("  (none)", "dim"));
    return;
  }
  ytDlpCalls.forEach((call, index) => {
    const status = call.ok ? paint("ok", "green") : paint("fail", "red");
    const target = call.target.replace(/^https:\/\/www\.youtube\.com\/watch\?v=/, "watch=");
    console.log(
      `  ${String(index + 1).padStart(2)}  ${String(call.ms).padStart(6)} ms  ${status.padEnd(12)}  ${target.slice(0, 82)}${call.error ? paint(`  ${call.error}`, "dim") : ""}`,
    );
    if (call.entries !== undefined && call.entries >= 0) {
      console.log(
        paint(`      entries=${call.entries} bytes=${call.stdoutBytes ?? "?"}`, "dim"),
      );
      if (call.titles?.length) {
        console.log(paint(`      ${call.titles.join(" | ")}`, "dim"));
      }
    } else if (call.url) {
      console.log(
        paint(
          `      url host=${call.host} bytes=${call.stdoutBytes ?? "?"}`,
          "dim",
        ),
      );
    } else {
      console.log(paint("      no URL returned", "dim"));
    }
  });
  const total = ytDlpCalls.reduce((sum, call) => sum + call.ms, 0);
  console.log(
    `  ${paint("total", "bold")} ${String(total).padStart(6)} ms across ${ytDlpCalls.length} calls`,
  );
}

async function runLive() {
  console.log(paint("\nLive resolve", "bold"));

  const input = {
    trackId: "0VjIjW4GlUZAMYd2vXMi3b",
    title: "Blinding Lights",
    artist: "The Weeknd",
    album: "After Hours",
    durationMs: 200_000,
  };

  const callsBefore = ytDlpCalls.length;
  const startedAt = performance.now();
  let result = null;
  let error = null;
  try {
    result = await resolveFullStream(input);
  } catch (caught) {
    error = caught;
  }
  const resolveMs = Math.round(performance.now() - startedAt);
  const resolveCalls = ytDlpCalls.length - callsBefore;
  const resolveRecords = ytDlpCalls.slice(callsBefore);
  const searchFallback = resolveRecords.some((call) =>
    call.target.startsWith("ytsearch"),
  );

  console.log(
    searchFallback
      ? paint(
          `  note: direct search missed — resolver fell back to yt-dlp ytsearch (${resolveMs} ms)`,
          "yellow",
        )
      : paint(`  direct Innertube search used (${resolveMs} ms)`, "dim"),
  );

  check(
    "resolves a full YouTube stream",
    Boolean(result && result.source === "youtube" && result.kind === "full"),
    error ? String(error.message ?? error) : `source=${result?.source}`,
  );
  if (!result) return;

  check(
    "returns an HTTPS progressive URL",
    result.url.startsWith("https://") && utils.directHttps(result.url) === result.url,
    result.url.slice(0, 70),
  );
  check(
    "cached result carries a future expiry",
    typeof result.expiresAt === "number" && result.expiresAt > Date.now(),
  );
  check(
    "resolve stays under the 20 s budget",
    resolveMs < 20_000,
    `${resolveMs} ms`,
  );
  check(
    "uses at most 6 yt-dlp calls",
    resolveCalls <= 6,
    `${resolveCalls} calls`,
  );
  if (resolveCalls > 2) {
    console.log(
      paint(
        `  note: ${resolveCalls} yt-dlp calls — the first candidate was unplayable, resolver fell through`,
        "yellow",
      ),
    );
  }

  const head = await utils.probeMediaRange(
    result.url,
    "bytes=0-1023",
    10_000,
  );
  check(
    "head range probe returns media",
    Boolean(head?.ok) && (!head.type || /^(audio|video)\//.test(head.type)),
    head ? `${head.type || "no-type"} total=${head.total}` : "no response",
  );

  if (head?.total > 0) {
    const tailStart = Math.max(0, head.total - 65_536);
    const tail = await utils.probeMediaRange(
      result.url,
      `bytes=${tailStart}-${head.total - 1}`,
      10_000,
    );
    check(
      "tail range probe returns media",
      Boolean(tail?.ok) && (!tail.type || /^(audio|video)\//.test(tail.type)),
      tail ? `${tail.type || "no-type"}` : "no response",
    );
  } else {
    console.log(
      paint("  skip  tail probe (CDN did not report a content length)", "dim"),
    );
  }

  const cacheStartedAt = performance.now();
  const cached = await resolveFullStream(input);
  const cacheMs = Math.round(performance.now() - cacheStartedAt);
  check(
    "cache hit returns the same URL without yt-dlp",
    cached?.url === result.url && ytDlpCalls.length === callsBefore + resolveCalls,
    `${cacheMs} ms`,
  );
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

app.disableHardwareAcceleration();

app
  .whenReady()
  .then(async () => {
    try {
      runFixtures();
      await runDirectSearch();
      await runFallback();
      await runLive();
      printCalls();
    } catch (error) {
      failures += 1;
      console.error(paint(`\nUnhandled: ${error?.stack ?? error}`, "red"));
    }

    console.log(
      `\n${failures === 0 ? paint("All resolver tests passed.", "green") : paint(`${failures} resolver test(s) failed.`, "red")}\n`,
    );
    app.exit(failures === 0 ? 0 : 1);
  })
  .catch((error) => {
    console.error(paint(`Electron failed to start: ${error?.stack ?? error}`, "red"));
    app.exit(1);
  });
