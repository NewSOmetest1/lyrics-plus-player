#!/usr/bin/env node
/**
 * Cached-lyrics search test for Lyrics+.
 *
 * Usage:
 *   npm run test:search
 *
 * Pure fixtures only: parsing, matching, one-result-per-track and synced
 * preference for the global "In Lyrics" search.
 */

const path = require("node:path");

const BUNDLE = path.join(
  __dirname,
  "..",
  "node_modules/.cache/lyrics-plus/lyrics-search.test.cjs",
);

const color = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  red: "\x1b[31m",
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
    return;
  }
  failures += 1;
  console.log(
    `  ${paint("FAIL", "red")} ${name}${detail ? paint(`  ${detail}`, "dim") : ""}`,
  );
}

let utils;
try {
  utils = require(BUNDLE);
} catch (error) {
  console.error(
    paint(`Cannot load ${BUNDLE}\n${error?.stack ?? error}`, "red"),
  );
  process.exit(1);
}

function track(id, title, artist) {
  return {
    id,
    path: `/music/${id}.flac`,
    title,
    artist,
    album: "ira domini",
    albumArtist: artist,
    spotifyTrackId: null,
    genre: null,
    year: 2026,
    trackNo: 1,
    durationMs: 97_000,
    format: "FLAC",
    bitrate: 981_849,
    sampleRate: 44_100,
    bitDepth: 16,
    channels: 2,
    fileSize: 1,
    fileName: `${id}.flac`,
    modifiedAt: 0,
    coverPath: null,
    coverFullPath: null,
    hasEmbeddedLyrics: false,
    addedAt: 0,
  };
}

const tracks = [
  track(1, "в ад", "норман грейсон"),
  track(2, "Dernière danse", "Indila"),
  track(3, "Blinding Lights", "The Weeknd"),
];

const lyrics = {
  1: [
    {
      source: "genius",
      synced: false,
      content:
        "[Текст песни «в ад»]\n\n[Интро]\nВнимание! Это не для детских ушей\n\n[Припев]\nИ я убегаю в ад, чтобы найти там похожих\nИ я убегаю в ад, чтобы найти там похожих",
      fetchedAt: 1,
    },
  ],
  2: [
    {
      source: "lrclib",
      synced: true,
      content:
        "[00:12.34]Dernière danse\n[00:16.00]Je remue le ciel\n[00:20.50]En vain",
      fetchedAt: 1,
    },
  ],
  3: [
    {
      source: "embedded",
      synced: false,
      content: "I look around and Sin City's cold and empty",
      fetchedAt: 1,
    },
  ],
};

console.log(paint("\nParser", "bold"));
const parsed = utils.parseSearchableLyrics(lyrics[1][0].content);
check(
  "drops metadata, section headers and empty lines",
  parsed.length === 3 &&
    parsed.every((line) => !/текст песни|интро|припев/i.test(line.text)),
  `${parsed.length} lines`,
);
check(
  "reads LRC timestamps",
  utils.parseSearchableLyrics(lyrics[2][0].content)[0].timeMs === 12_340,
);
check(
  "keeps plain lines untimed",
  parsed[0].timeMs === null,
);

console.log(paint("\nSearch", "bold"));
const russian = utils.searchCachedLyrics(tracks, lyrics, "убегаю в ад");
check(
  "finds plain Genius text with a snippet",
  russian.length === 1 &&
    russian[0].track.id === 1 &&
    russian[0].synced === false &&
    russian[0].lineTimeMs === null &&
    russian[0].lineText.includes("убегаю в ад"),
);
check(
  "counts repeated matches in the same line",
  utils.searchCachedLyrics(
    [tracks[0]],
    {
      1: [
        {
          source: "genius",
          synced: false,
          content: "убегаю в ад, снова убегаю в ад",
          fetchedAt: 1,
        },
      ],
    },
    "убегаю в ад",
  )[0]?.matchCount === 2,
);
check(
  "reports the match offset for highlighting",
  russian[0]?.matchStart === 4 && russian[0]?.matchLength === 11,
);

const french = utils.searchCachedLyrics(tracks, lyrics, "danse");
check(
  "finds synced lyrics with their timestamp",
  french.length === 1 &&
    french[0].track.id === 2 &&
    french[0].synced === true &&
    french[0].lineTimeMs === 12_340,
);

const english = utils.searchCachedLyrics(tracks, lyrics, "sin city");
check(
  "is case-insensitive",
  english.length === 1 && english[0].track.id === 3,
);

check(
  "ignores metadata and section headers",
  utils.searchCachedLyrics(tracks, lyrics, "текст песни").length === 0 &&
    utils.searchCachedLyrics(tracks, lyrics, "припев").length === 0,
);

check(
  "one result per track",
  utils.searchCachedLyrics(tracks, lyrics, "и я").length === 1,
);

check(
  "requires at least two characters",
  utils.searchCachedLyrics(tracks, lyrics, "я").length === 0,
);

check(
  "honours the result limit",
  utils.searchCachedLyrics(tracks, lyrics, "и я", 0).length === 1 &&
    utils.searchCachedLyrics(tracks, lyrics, "и я", 1).length === 1,
);

const syncedPreferred = utils.searchCachedLyrics(
  [tracks[0]],
  {
    1: [
      {
        source: "genius",
        synced: false,
        content: "убегаю в ад\nубегаю в ад\nубегаю в ад",
        fetchedAt: 1,
      },
      {
        source: "lrclib",
        synced: true,
        content: "[00:10.00]убегаю в ад",
        fetchedAt: 2,
      },
    ],
  },
  "убегаю в ад",
);
check(
  "prefers the synced cache entry",
  syncedPreferred.length === 1 &&
    syncedPreferred[0].source === "lrclib" &&
    syncedPreferred[0].lineTimeMs === 10_000,
);

console.log(
  `\n${failures === 0 ? paint("All lyric search tests passed.", "green") : paint(`${failures} lyric search test(s) failed.`, "red")}\n`,
);

process.exit(failures === 0 ? 0 : 1);
