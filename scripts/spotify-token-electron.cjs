/**
 * Electron entry used by `npm run test:lyrics`.
 * Runs the exact same native token helper as the app and prints one JSON line.
 */
const { app, BrowserWindow, session } = require("electron");
const { getSpotifyAccessToken } = require("../electron/spotify-auth.cjs");

const spDc = process.env.SPOTIFY_SP_DC?.trim() || "";
const spKey = process.env.SPOTIFY_SP_KEY?.trim() || "";

app.commandLine.appendSwitch("disable-gpu");

app.whenReady().then(async () => {
  try {
    const result = await getSpotifyAccessToken({ BrowserWindow, session }, spDc, spKey);
    process.stdout.write(`SPOTIFY_TOKEN_RESULT=${JSON.stringify(result)}\n`);
    setTimeout(() => app.exit(result.token ? 0 : 2), 50);
  } catch (error) {
    process.stdout.write(
      `SPOTIFY_TOKEN_RESULT=${JSON.stringify({
        token: null,
        status: null,
        message: `Helper crash: ${error instanceof Error ? error.message : String(error)}`,
      })}\n`,
    );
    setTimeout(() => app.exit(3), 50);
  }
});

app.on("window-all-closed", () => {
  // keep the helper alive until the token result is printed
});
