import type { Track } from "@/types";

/**
 * Deterministic, dependency-free gradient artwork for the browser preview.
 * Real builds use cover art extracted by the Rust scanner.
 */
function cover(colors: [string, string, string], variant: number): string {
  const [a, b, c] = colors;
  const shapes = [
    `<circle cx="610" cy="230" r="270" fill="${c}" opacity=".75"/>
     <circle cx="230" cy="640" r="330" fill="${b}" opacity=".55"/>
     <path d="M0 610 C 220 470 380 780 800 540 L800 800 L0 800 Z" fill="${a}" opacity=".6"/>`,
    `<rect x="90" y="90" width="620" height="620" rx="310" fill="none" stroke="${c}" stroke-width="70" opacity=".5"/>
     <circle cx="400" cy="400" r="210" fill="${b}" opacity=".65"/>
     <circle cx="620" cy="580" r="120" fill="${a}" opacity=".75"/>`,
    `<path d="M80 560 Q 240 260 400 560 T 720 560" fill="none" stroke="${c}" stroke-width="58" stroke-linecap="round" opacity=".7"/>
     <path d="M80 660 Q 240 360 400 660 T 720 660" fill="none" stroke="${a}" stroke-width="34" stroke-linecap="round" opacity=".55"/>
     <circle cx="590" cy="250" r="130" fill="${b}" opacity=".55"/>`,
    `<circle cx="400" cy="400" r="300" fill="${b}" opacity=".4"/>
     <circle cx="400" cy="400" r="180" fill="none" stroke="${c}" stroke-width="42" opacity=".65"/>
     <circle cx="400" cy="400" r="52" fill="${a}"/>
     <circle cx="650" cy="190" r="36" fill="${c}"/>`,
    `<path d="M0 300 L800 100 L800 340 L0 540 Z" fill="${c}" opacity=".45"/>
     <path d="M0 520 L800 320 L800 560 L0 760 Z" fill="${b}" opacity=".45"/>
     <circle cx="210" cy="220" r="86" fill="${a}" opacity=".85"/>`,
    `<rect x="140" y="140" width="520" height="520" rx="90" fill="${b}" opacity=".42"/>
     <rect x="260" y="260" width="280" height="280" rx="140" fill="${c}" opacity=".6"/>
     <circle cx="400" cy="400" r="62" fill="${a}"/>`,
  ];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#121216"/>
        <stop offset="1" stop-color="#07070a"/>
      </linearGradient>
      <radialGradient id="glow" cx="30%" cy="20%" r="90%">
        <stop offset="0" stop-color="${a}" stop-opacity=".34"/>
        <stop offset="1" stop-color="${a}" stop-opacity="0"/>
      </radialGradient>
      <filter id="blur"><feGaussianBlur stdDeviation="46"/></filter>
    </defs>
    <rect width="800" height="800" fill="url(#bg)"/>
    <rect width="800" height="800" fill="url(#glow)"/>
    <g filter="url(#blur)" opacity=".8">${shapes[variant % shapes.length]}</g>
    <rect width="800" height="800" fill="#07070a" opacity=".12"/>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const covers = [
  cover(["#ff9a3c", "#ff5e62", "#ffcf70"], 0),
  cover(["#6ee7f9", "#3b82f6", "#a78bfa"], 1),
  cover(["#f472b6", "#a855f7", "#fbbf24"], 2),
  cover(["#34d399", "#0ea5e9", "#a3e635"], 3),
  cover(["#f87171", "#fb923c", "#fde68a"], 4),
  cover(["#c084fc", "#6366f1", "#22d3ee"], 5),
  cover(["#fbbf24", "#f97316", "#ef4444"], 0),
  cover(["#38bdf8", "#818cf8", "#f0abfc"], 1),
];

function track(
  id: number,
  title: string,
  artist: string,
  album: string,
  durationMs: number,
  format: string,
  options: Partial<Track> = {},
): Track {
  return {
    id,
    path: `/demo/${id}.${format.toLowerCase()}`,
    title,
    artist,
    album,
    albumArtist: artist,
    genre: "Dream Pop",
    year: 2026,
    trackNo: id,
    durationMs,
    format,
    bitrate: format === "FLAC" ? 2304 : 320,
    sampleRate: format === "FLAC" ? 96000 : 44100,
    bitDepth: format === "FLAC" ? 24 : 16,
    channels: 2,
    fileSize: 42_000_000,
    fileName: `${String(id).padStart(2, "0")} - ${title.replace(/[\\/:*?"<>|]/g, "-")}.${format.toLowerCase()}`,
    modifiedAt: 1_767_000_000_000 + id * 86_400_000,
    coverPath: covers[(id - 1) % covers.length],
    coverFullPath: covers[(id - 1) % covers.length],
    hasEmbeddedLyrics: id <= 3,
    addedAt: 1_767_000_000 + id,
    ...options,
  };
}

export const DEMO_TRACKS: Track[] = [
  track(1, "Neon Afterglow", "Aurora Vale", "Midnight Bloom", 222_000, "FLAC"),
  track(2, "Paper Moons", "The Slow Static", "Analog Hearts", 245_000, "FLAC", {
    bitrate: 1411,
    sampleRate: 44100,
    bitDepth: 16,
    coverPath: covers[1],
    coverFullPath: covers[1],
  }),
  track(3, "Velvet Skies", "Mira Sol", "Soft Focus", 198_000, "MP3", {
    bitrate: 320,
    sampleRate: 48000,
    bitDepth: 16,
    coverPath: covers[2],
    coverFullPath: covers[2],
  }),
  track(4, "Midnight Drive", "Kaito Ren", "Night Circuit", 178_000, "FLAC", {
    coverPath: covers[3],
    coverFullPath: covers[3],
  }),
  track(5, "Hollow Bloom", "Lumen", "Afterimage", 312_000, "OPUS", {
    bitrate: 256,
    sampleRate: 48000,
    bitDepth: 24,
    coverPath: covers[4],
    coverFullPath: covers[4],
  }),
  track(6, "Static Bloom", "Aurora Vale", "Midnight Bloom", 216_000, "FLAC", {
    coverPath: covers[5],
    coverFullPath: covers[5],
  }),
  track(7, "Glass Rivers", "The Slow Static", "Analog Hearts", 262_000, "WAV", {
    bitrate: 1411,
    sampleRate: 44100,
    bitDepth: 16,
    coverPath: covers[6],
    coverFullPath: covers[6],
  }),
  track(8, "Slow Motion", "Mira Sol", "Soft Focus", 224_000, "FLAC", {
    coverPath: covers[7],
    coverFullPath: covers[7],
  }),
];

export const DEMO_LYRICS: Record<number, string> = {
  1: `[ar:Aurora Vale]
[ti:Neon Afterglow]
[al:Midnight Bloom]
[length:03:42]
[00:07.20]The city hums beneath my skin
[00:11.80]A frequency I let it in
[00:16.20]Every window burns a different sun
[00:20.90]We were never good at running
[00:25.40]Neon afterglow, paint me slow
[00:30.10]All the colours that we used to know
[00:34.80]Hold the night a little longer now
[00:39.50]I don't want to come back down
[00:44.40]Static on the radio
[00:48.90]Singing every word we used to know
[00:53.60]If the morning takes you home
[00:58.30]Leave a light on, leave a light on
[01:05.00]We were sparks in a paper sky
[01:09.70]Burning bright, never asking why
[01:14.30]Every shadow learned to move like us
[01:19.00]Slow and quiet, dangerous
[01:23.80]Neon afterglow, paint me slow
[01:28.50]All the colours that we used to know
[01:33.20]Hold the night a little longer now
[01:37.90]I don't want to come back down
[01:42.80]And the city keeps on breathing
[01:47.40]Every streetlight is a feeling
[01:52.10]We are floating, we are freezing
[01:56.80]In the glow
[02:03.50]Static on the radio
[02:08.20]Singing every word we used to know
[02:12.90]If the morning takes you home
[02:17.60]Leave a light on, leave a light on
[02:25.10]Neon afterglow, paint me slow
[02:29.80]All the colours that we used to know
[02:34.50]Hold the night a little longer now
[02:39.20]I don't want to come back down
[02:43.90]I don't want to come back down
[02:48.60]Leave a light on
[02:53.30]Leave a light on
[03:00.00]Neon afterglow
[03:05.00]Neon afterglow
[03:12.00]The city hums beneath my skin
[03:18.00]A frequency I let it in
[03:24.00]Leave a light on
[03:30.00]Leave a light on`,
  2: `[ar:The Slow Static]
[ti:Paper Moons]
[al:Analog Hearts]
[00:09.00]We folded paper moons
[00:14.20]And hung them from the ceiling
[00:19.40]Every room a little universe
[00:24.60]Every word a feeling
[00:31.00]Analog hearts, don't break so fast
[00:36.20]We've got hours left to make this last
[00:41.40]Spinning slow beneath the tape machine
[00:46.60]Nothing here is what it seems
[00:54.00]Paper moons will fall apart
[00:59.20]But they leave a little light
[01:04.40]In the corners of the dark
[01:09.60]Every single night
[01:17.00]Analog hearts, don't break so fast
[01:22.20]We've got hours left to make this last
[01:27.40]Spinning slow beneath the tape machine
[01:32.60]Nothing here is what it seems`,
  3: `We drive until the skyline turns to dust
And every star is something we can trust
The radio is whispering our names
Velvet skies and little paper flames

If tomorrow finds us on the floor
We'll pretend we never wanted more
So hold my hand and count the city lights
We can stay inside the velvet skies

Every hour feels a little slower now
Every shadow learns to show me how
To disappear without a sound
To leave my feet above the ground

Velvet skies, velvet skies
Keep the morning from my eyes
Velvet skies, velvet skies
Tell me pretty little lies`,
};

export function demoLyricsFor(trackId: number): string | null {
  return DEMO_LYRICS[trackId] ?? null;
}
