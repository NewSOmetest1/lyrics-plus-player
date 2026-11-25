#!/usr/bin/env node
/**
 * Genius provider test for Lyrics+.
 *
 * Usage:
 *   npm run test:genius
 *
 * Pure fixtures only: no network. Verifies the two safety rules of the
 * unsynced fallback — strict title/artist matching and translation-page
 * rejection — plus the HTML-to-text parser.
 */

const path = require("node:path");
const { app } = require("electron");

const ROOT = path.resolve(__dirname, "..");
const BUNDLE = path.join(
  ROOT,
  "node_modules/.cache/lyrics-plus/lyrics.test.cjs",
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
    return true;
  }
  failures += 1;
  console.log(
    `  ${paint("FAIL", "red")} ${name}${detail ? paint(`  ${detail}`, "dim") : ""}`,
  );
  return false;
}

let utils;
try {
  utils = require(BUNDLE).geniusTestUtils;
  if (!utils) throw new Error("geniusTestUtils is missing from the bundle");
} catch (error) {
  console.error(
    paint(`Cannot load ${BUNDLE}\n${error?.stack ?? error}`, "red"),
  );
  process.exit(1);
}

const SONG_URL = "https://genius.com/Indila-derniere-danse-lyrics";

function runFixtures() {
  console.log(paint("\nTranslation filter", "bold"));
  for (const [artist, expected] of [
    ["Genius English Translations", true],
    ["Genius (English) Translations", true],
    ["Genius Türkçe Çeviriler", true],
    ["Genius Brasil Traduções", true],
    ["Indila", false],
    ["The Weeknd", false],
  ]) {
    check(
      `"${artist}" -> ${expected ? "rejected" : "accepted"}`,
      utils.isGeniusTranslationArtist(artist) === expected,
    );
  }

  console.log(paint("\nStrict matching", "bold"));
  const original = {
    title: "Dernière danse",
    primary_artist: { name: "Indila" },
    url: SONG_URL,
  };
  check(
    "translation-only result is refused",
    utils.selectGeniusSong(
      [
        {
          title: "Dernière danse",
          primary_artist: { name: "Genius English Translations" },
          artist_names: "Genius English Translations",
          url: SONG_URL,
        },
      ],
      "Dernière danse",
      "Indila",
    ) === null,
  );
  check(
    "exact title and artist are accepted",
    utils.selectGeniusSong([original], "Dernière danse", "Indila") === original,
  );
  check(
    "different artist is refused",
    utils.selectGeniusSong(
      [{ ...original, primary_artist: { name: "Some Cover Band" } }],
      "Dernière danse",
      "Indila",
    ) === null,
  );
  check(
    "different title is refused",
    utils.selectGeniusSong(
      [{ ...original, title: "Dernière danse (English Translation)" }],
      "Dernière danse",
      "Indila",
    ) === null,
  );
  check(
    "remaster suffix is cleaned before matching",
    utils.selectGeniusSong(
      [
        {
          title: "Blinding Lights - Remastered 2020",
          primary_artist: { name: "The Weeknd" },
          url: "https://genius.com/The-weeknd-blinding-lights-lyrics",
        },
      ],
      "Blinding Lights",
      "The Weeknd",
    ) !== null,
  );
  const translated = {
    title: "в ад (to hell)",
    artist_names: "норман грейсон (norman greyson)",
    primary_artist: { name: "норман грейсон (norman greyson)" },
    url: "https://genius.com/Norman-greyson-to-hell-lyrics",
  };
  check(
    "translated parenthetical title and artist alias are accepted",
    utils.selectGeniusSong([translated], "в ад", "нормал грейсон") === translated,
  );
  check(
    "version parenthetical is refused",
    utils.selectGeniusSong(
      [
        {
          title: "Dernière danse (Remix)",
          primary_artist: { name: "Indila" },
          url: SONG_URL,
        },
      ],
      "Dernière danse",
      "Indila",
    ) === null,
  );
  check(
    "non-genius song URL is refused",
    utils.geniusSongUrl({ url: "https://evil.example/The-weeknd-blinding-lights-lyrics" }) ===
      null &&
      utils.geniusSongUrl({ url: SONG_URL }) === SONG_URL,
  );

  console.log(paint("\nHTML parser", "bold"));
  const html = `
    <div data-lyrics-container="true" class="Lyrics__Container">
      <div data-exclude-from-selection="true">
        <div class="header">Contributors</div>
        <button>Embed</button>
      </div>
      [Verse 1]<br/>
      I&#x27;ve been tryna call<br/>
      <a href="/x">Line with <b>bold</b></a><br/>
      <br/>
      [Chorus]<br/>
      &amp; more&nbsp;text
    </div>
    <div data-lyrics-container="true" class="Lyrics__Container">Second container<br/>Line</div>
  `;
  const parsed = utils.parseGeniusLyrics(html);
  const expected = [
    "[Verse 1]",
    "I've been tryna call",
    "Line with bold",
    "",
    "[Chorus]",
    "& more text",
    "",
    "Second container",
    "Line",
  ].join("\n");

  check(
    "extracts lyrics, drops headers and decodes entities",
    parsed === expected,
    parsed ? JSON.stringify(parsed.slice(0, 40)) : "no output",
  );
  check(
    "challenge/empty pages return null",
    utils.parseGeniusLyrics("<html>Just a moment...</html>") === null,
  );
}

app.disableHardwareAcceleration();

app
  .whenReady()
  .then(() => {
    runFixtures();
    console.log(
      `\n${failures === 0 ? paint("All Genius tests passed.", "green") : paint(`${failures} Genius test(s) failed.`, "red")}\n`,
    );
    app.exit(failures === 0 ? 0 : 1);
  })
  .catch((error) => {
    console.error(paint(`Electron failed to start: ${error?.stack ?? error}`, "red"));
    app.exit(1);
  });
