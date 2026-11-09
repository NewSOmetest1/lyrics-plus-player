import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

/**
 * Read the artist collection from the local Spotify desktop client.
 *
 * The web-player session used by the rest of the app is not necessarily the
 * same Spotify account as the desktop client. The desktop cache is the only
 * local source that reflects the account that owns the user's music library,
 * so it is used as the authoritative list of followed artists when present.
 *
 * Spotify stores its collection in a LevelDB-compatible database using a
 * custom comparator ("greenbase.KeyComparator"). We only read the SST files,
 * which are immutable once written, and newer write-ahead logs. Nothing is
 * locked or modified.
 */

export interface SpotifyDesktopArtist {
  id: string;
  name: string;
}

export interface SpotifyDesktopCollection {
  artists: SpotifyDesktopArtist[];
  source: string;
}

interface DbEntry {
  key: string;
  sequence: number;
  value: Buffer;
}

interface BlockHandle {
  offset: number;
  size: number;
}

const ARTIST_KEY = /%spotify:artist:([A-Za-z0-9]{22})#/;
const DB_BLOCK_SIZE = 32 * 1024;

function cacheRoots(): string[] {
  const home = os.homedir();
  const roots = [
    process.env.XDG_CACHE_HOME
      ? path.join(process.env.XDG_CACHE_HOME, "spotify")
      : "",
    path.join(home, ".cache", "spotify"),
    path.join(home, ".var/app/com.spotify.Client/cache/spotify"),
    path.join(home, "snap/spotify/common/.cache/spotify"),
    path.join(home, "Library/Application Support/Spotify"),
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, "Spotify")
      : "",
    process.env.APPDATA ? path.join(process.env.APPDATA, "Spotify") : "",
  ];
  return roots.filter(Boolean);
}

function configRoots(): string[] {
  const home = os.homedir();
  const roots = [
    process.env.XDG_CONFIG_HOME
      ? path.join(process.env.XDG_CONFIG_HOME, "spotify")
      : "",
    path.join(home, ".config", "spotify"),
    path.join(home, ".var/app/com.spotify.Client/config/spotify"),
    path.join(home, "snap/spotify/current/.config/spotify"),
    path.join(home, "Library/Application Support/Spotify"),
    process.env.APPDATA ? path.join(process.env.APPDATA, "Spotify") : "",
  ];
  return roots.filter(Boolean);
}

function activeUsername(): string | null {
  for (const root of configRoots()) {
    const prefs = path.join(root, "prefs");
    if (!existsSync(prefs)) continue;
    try {
      const text = readFileSync(prefs, "utf8");
      const match =
        /^autologin\.canonical_username="?([^"\r\n]+)"?/m.exec(text);
      const username = match?.[1]?.trim();
      if (username) return username;
    } catch {
      // try the next profile
    }
  }
  return null;
}

function databaseDirectory(): string | null {
  const username = activeUsername();
  for (const root of cacheRoots()) {
    const users = path.join(root, "Users");
    if (!existsSync(users)) continue;
    if (username) {
      const direct = path.join(users, `${username}-user`, "primary.ldb");
      if (existsSync(direct)) return direct;
    }
    let best: { dir: string; mtime: number } | null = null;
    for (const entry of readdirSync(users, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.endsWith("-user")) continue;
      const dir = path.join(users, entry.name, "primary.ldb");
      if (!existsSync(dir)) continue;
      const mtime = statSync(dir).mtimeMs;
      if (!best || mtime > best.mtime) best = { dir, mtime };
    }
    if (best) return best.dir;
  }
  return null;
}

function readVarint(buffer: Buffer, position: number): [number, number] {
  let value = 0;
  let shift = 0;
  for (let index = 0; index < 10; index += 1) {
    const byte = buffer[position + index];
    if (byte === undefined) throw new Error("truncated varint");
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return [value, position + index + 1];
    shift += 7;
  }
  throw new Error("invalid varint");
}

/** Decode a raw Snappy block (used by LevelDB SST blocks). */
function snappyDecompress(input: Buffer): Buffer {
  const [expected, start] = readVarint(input, 0);
  let position = start;
  const output = Buffer.allocUnsafe(expected);
  let written = 0;

  while (position < input.length) {
    const tag = input[position];
    position += 1;
    const type = tag & 3;
    if (type === 0) {
      let length = tag >> 2;
      if (length < 60) {
        length += 1;
      } else {
        const extra = length - 59;
        length = 0;
        for (let index = 0; index < extra; index += 1) {
          length += input[position + index] * 2 ** (8 * index);
        }
        position += extra;
        length += 1;
      }
      input.copy(output, written, position, position + length);
      position += length;
      written += length;
    } else if (type === 1) {
      const length = 4 + ((tag >> 2) & 7);
      const offset = ((tag >> 5) << 8) | input[position];
      position += 1;
      for (let index = 0; index < length; index += 1) {
        output[written + index] = output[written - offset + index];
      }
      written += length;
    } else if (type === 2) {
      const length = 1 + (tag >> 2);
      const offset = input[position] | (input[position + 1] << 8);
      position += 2;
      for (let index = 0; index < length; index += 1) {
        output[written + index] = output[written - offset + index];
      }
      written += length;
    } else {
      const length = 1 + (tag >> 2);
      const offset =
        input[position] |
        (input[position + 1] << 8) |
        (input[position + 2] << 16) |
        (input[position + 3] << 24);
      position += 4;
      for (let index = 0; index < length; index += 1) {
        output[written + index] = output[written - offset + index];
      }
      written += length;
    }
  }

  if (written !== expected) {
    throw new Error(`snappy size mismatch (${written} != ${expected})`);
  }
  return output;
}

function readBlock(data: Buffer, handle: BlockHandle): Buffer {
  const raw = data.subarray(handle.offset, handle.offset + handle.size);
  const compression = data[handle.offset + handle.size];
  if (compression === 0) return raw;
  if (compression === 1) return snappyDecompress(raw);
  if (compression === 2) return zlib.inflateSync(raw);
  throw new Error(`unsupported block compression ${compression}`);
}

function* parseBlock(data: Buffer): Generator<[Buffer, Buffer]> {
  if (data.length < 4) return;
  const restarts = data.readUInt32LE(data.length - 4);
  const restartOffset = data.length - 4 - restarts * 4;
  let position = 0;
  let lastKey = Buffer.alloc(0);
  while (position < restartOffset) {
    let shared: number;
    let nonShared: number;
    let valueLength: number;
    [shared, position] = readVarint(data, position);
    [nonShared, position] = readVarint(data, position);
    [valueLength, position] = readVarint(data, position);
    const key = Buffer.concat([
      lastKey.subarray(0, shared),
      data.subarray(position, position + nonShared),
    ]);
    position += nonShared;
    const value = data.subarray(position, position + valueLength);
    position += valueLength;
    lastKey = key;
    yield [key, value];
  }
}

/**
 * Spotify's custom keys end with an 8-byte version stamp. The lowest byte is
 * a flag and the remaining seven bytes are a monotonically increasing value.
 * Tombstones are represented by an empty value.
 */
function parseInternalKey(
  key: Buffer,
  value: Buffer,
): { key: string; sequence: number; value: Buffer } | null {
  if (key.length < 8) return null;
  const sequence =
    key.readUInt32LE(key.length - 8) +
    key.readUInt32LE(key.length - 4) * 2 ** 32;
  return {
    key: key.subarray(0, key.length - 8).toString("latin1"),
    sequence,
    value,
  };
}

function readSst(
  file: string,
  accept: (entry: DbEntry) => void,
): boolean {
  let data: Buffer;
  try {
    data = readFileSync(file);
  } catch {
    return false;
  }
  try {
    if (data.length < 48) return false;
    const footer = data.subarray(data.length - 48);
    let position = 0;
    let metaOffset: number;
    [metaOffset, position] = readVarint(footer, position);
    let metaSize: number;
    [metaSize, position] = readVarint(footer, position);
    let indexOffset: number;
    [indexOffset, position] = readVarint(footer, position);
    let indexSize: number;
    [indexSize, position] = readVarint(footer, position);
    void metaOffset;
    void metaSize;
    const index = readBlock(data, {
      offset: indexOffset,
      size: indexSize,
    });
    for (const [, handle] of parseBlock(index)) {
      let blockOffset: number;
      let blockSize: number;
      let handlePosition = 0;
      [blockOffset, handlePosition] = readVarint(handle, handlePosition);
      [blockSize, handlePosition] = readVarint(handle, handlePosition);
      const block = readBlock(data, {
        offset: blockOffset,
        size: blockSize,
      });
      for (const [key, value] of parseBlock(block)) {
        const entry = parseInternalKey(key, value);
        if (entry) accept(entry);
      }
    }
    return true;
  } catch {
    return false;
  }
}

function parseWriteBatch(
  batch: Buffer,
  accept: (entry: DbEntry) => void,
): void {
  if (batch.length < 12) return;
  const baseSequence = Number(batch.readBigUInt64LE(0));
  const count = batch.readUInt32LE(8);
  let position = 12;
  for (let index = 0; index < count; index += 1) {
    if (position >= batch.length) return;
    const tag = batch[position];
    position += 1;
    let keyLength: number;
    [keyLength, position] = readVarint(batch, position);
    if (position + keyLength > batch.length) return;
    const key = batch.subarray(position, position + keyLength).toString("latin1");
    position += keyLength;
    let value: Buffer = Buffer.alloc(0);
    if (tag === 1) {
      let valueLength: number;
      [valueLength, position] = readVarint(batch, position);
      if (position + valueLength > batch.length) return;
      value = batch.subarray(position, position + valueLength);
      position += valueLength;
    }
    accept({ key, sequence: baseSequence + index, value });
  }
}

/** Replay records from a LevelDB write-ahead log. */
function readLog(
  file: string,
  accept: (entry: DbEntry) => void,
): boolean {
  let data: Buffer;
  try {
    data = readFileSync(file);
  } catch {
    return false;
  }
  let position = 0;
  let fragments: Buffer[] = [];
  let fragmentLength = 0;
  while (position + 7 <= data.length) {
    const blockLeft = DB_BLOCK_SIZE - (position % DB_BLOCK_SIZE);
    if (blockLeft < 7) {
      position += blockLeft;
      continue;
    }
    const length = data.readUInt16LE(position + 4);
    const type = data[position + 6];
    const start = position + 7;
    const end = start + length;
    if (length === 0 || end > data.length) break;
    if (type === 1) {
      parseWriteBatch(data.subarray(start, end), accept);
      fragments = [];
      fragmentLength = 0;
    } else if (type === 2) {
      fragments = [data.subarray(start, end)];
      fragmentLength = length;
    } else if (type === 3) {
      fragments.push(data.subarray(start, end));
      fragmentLength += length;
    } else if (type === 4) {
      fragments.push(data.subarray(start, end));
      fragmentLength += length;
      parseWriteBatch(Buffer.concat(fragments, fragmentLength), accept);
      fragments = [];
      fragmentLength = 0;
    }
    position = end;
  }
  return true;
}

function parseProtoString(value: Buffer): string | null {
  let position = 0;
  while (position < value.length) {
    const tag = value[position];
    position += 1;
    const field = tag >> 3;
    const wire = tag & 7;
    if (wire === 2) {
      let length: number;
      [length, position] = readVarint(value, position);
      if (position + length > value.length) return null;
      if (field === 2) {
        return value
          .subarray(position, position + length)
          .toString("utf8")
          .trim();
      }
      position += length;
    } else if (wire === 0) {
      let ignored: number;
      [ignored, position] = readVarint(value, position);
    } else {
      return null;
    }
  }
  return null;
}

interface ProtoField {
  field: number;
  wire: number;
  value: Buffer | number;
}

/** Minimal protobuf decoder for the fields Spotify metadata stores. */
function readProtoFields(value: Buffer): ProtoField[] {
  const fields: ProtoField[] = [];
  let position = 0;
  while (position < value.length) {
    let tag: number;
    try {
      [tag, position] = readVarint(value, position);
    } catch {
      break;
    }
    const field = tag >> 3;
    const wire = tag & 7;
    if (wire === 2) {
      let length: number;
      try {
        [length, position] = readVarint(value, position);
      } catch {
        break;
      }
      if (position + length > value.length) break;
      fields.push({
        field,
        wire,
        value: value.subarray(position, position + length),
      });
      position += length;
    } else if (wire === 0) {
      let number: number;
      try {
        [number, position] = readVarint(value, position);
      } catch {
        break;
      }
      fields.push({ field, wire, value: number });
    } else if (wire === 1) {
      position += 8;
    } else if (wire === 5) {
      position += 4;
    } else {
      break;
    }
  }
  return fields;
}

function protoText(field: ProtoField | undefined): string | null {
  if (!field || field.wire !== 2) return null;
  const text = (field.value as Buffer).toString("utf8").trim();
  return text || null;
}

function protoNumber(field: ProtoField | undefined): number | null {
  return field && field.wire === 0 ? Number(field.value) : null;
}

/** Spotify stores Track.duration (field 7) as `sint32` milliseconds. */
function zigzagNumber(value: number): number {
  return (value >>> 1) ^ -(value & 1);
}

/**
 * Spotify wraps cached metadata in one or two protobuf `Any` envelopes:
 * `{ 1: 10, 2: {...} }` and `{ 1: typeUrl, 2: payload }`. Peel them until the
 * actual `spotify.metadata.Track` message remains.
 */
function unwrapTrackMetadata(value: Buffer): Buffer {
  let current = value;
  for (let depth = 0; depth < 4; depth += 1) {
    const fields = readProtoFields(current);
    if (fields.length !== 2 || fields[0].field !== 1 || fields[1].field !== 2) {
      break;
    }
    const first = fields[0];
    const second = fields[1];
    if (second.wire !== 2) break;
    if (first.wire === 0) {
      current = second.value as Buffer;
      continue;
    }
    if (first.wire === 2) {
      const typeUrl = (first.value as Buffer).toString("utf8");
      if (!typeUrl.includes("spotify.metadata.Track")) break;
      current = second.value as Buffer;
      continue;
    }
    break;
  }
  return current;
}

const SPOTIFY_IMAGE_PATTERN =
  /https:\/\/i\.scdn\.co\/image\/[A-Za-z0-9]+/g;

function readCoverUrl(value: Buffer | undefined): string | null {
  if (!value) return null;
  const urls = value.toString("latin1").match(SPOTIFY_IMAGE_PATTERN) ?? [];
  return (
    urls.find((url) => url.includes("0000b273")) ??
    urls.find((url) => url.includes("00001e02")) ??
    urls[0] ??
    null
  );
}

function readDatabaseEntries(
  directory: string,
): Map<string, DbEntry> | null {
  let names: string[] = [];
  try {
    names = readdirSync(directory);
  } catch {
    return null;
  }

  const entries = new Map<string, DbEntry>();
  const remember = (entry: DbEntry): void => {
    const current = entries.get(entry.key);
    if (!current || entry.sequence > current.sequence) {
      entries.set(entry.key, entry);
    }
  };

  let latestSst = 0;
  for (const name of names) {
    if (!name.endsWith(".ldb")) continue;
    const number = Number.parseInt(name.slice(0, -4), 10);
    if (Number.isFinite(number)) latestSst = Math.max(latestSst, number);
    readSst(path.join(directory, name), remember);
  }

  // Only replay logs newer than the newest compacted table. Older logs are
  // already represented by the tables and use a different sequence domain.
  for (const name of names) {
    if (!name.endsWith(".log")) continue;
    const number = Number.parseInt(name.slice(0, -4), 10);
    if (!Number.isFinite(number) || number <= latestSst) continue;
    readLog(path.join(directory, name), remember);
  }

  return entries;
}

export interface SpotifyDesktopLikedTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  coverUrl: string | null;
  addedAt: number;
}

export interface SpotifyDesktopLikedCollection {
  tracks: SpotifyDesktopLikedTrack[];
  source: string;
  missingMetadata: number;
}

/**
 * Read liked tracks from the Spotify desktop collection.
 *
 * Keys such as `#col#col.trk#addtime#…#$spotify:track:<id>#` mark saved
 * tracks; the matching `!xmeta#cache#…#$spotify:track:<id>#` entries contain a
 * `spotify.metadata.Track` payload with title, artists, album, duration and
 * cover. This is used when the signed-in web account is not the account that
 * owns the user's desktop library.
 */
export function readSpotifyDesktopLikedTracks(): SpotifyDesktopLikedCollection | null {
  const directory = databaseDirectory();
  if (!directory) return null;
  const entries = readDatabaseEntries(directory);
  if (!entries) return null;

  const liked = new Map<string, string>();
  const metadata = new Map<string, Buffer>();
  const covers = new Map<string, Buffer>();
  const trackKeyPattern = /\$spotify:track:([A-Za-z0-9]{22})#?$/;
  const xmetaKeyPattern = /#\$spotify:track:([A-Za-z0-9]{22})#$/;

  for (const entry of entries.values()) {
    if (entry.key.startsWith("#col#col.trk")) {
      const match = trackKeyPattern.exec(entry.key);
      if (match) liked.set(match[1], entry.key);
      continue;
    }
    if (!entry.key.startsWith("!xmeta#cache#")) continue;
    const match = xmetaKeyPattern.exec(entry.key);
    if (!match) continue;
    const id = match[1];
    if (entry.value.includes("spotify.metadata.Track")) {
      const current = metadata.get(id);
      if (!current || entry.value.length > current.length) {
        metadata.set(id, entry.value);
      }
    }
    if (entry.value.includes("VisualIdentityTrait")) {
      const current = covers.get(id);
      if (!current || entry.value.length > current.length) {
        covers.set(id, entry.value);
      }
    }
  }

  const tracks: SpotifyDesktopLikedTrack[] = [];
  let missingMetadata = 0;
  for (const id of liked.keys()) {
    const raw = metadata.get(id);
    if (!raw) {
      missingMetadata += 1;
      continue;
    }
    const fields = readProtoFields(unwrapTrackMetadata(raw));
    const title = protoText(fields.find((field) => field.field === 2));
    if (!title) {
      missingMetadata += 1;
      continue;
    }
    const albumField = fields.find(
      (field) => field.field === 3 && field.wire === 2,
    );
    const albumFields = albumField
      ? readProtoFields(albumField.value as Buffer)
      : [];
    const album = protoText(
      albumFields.find((field) => field.field === 2),
    );
    const artists = fields
      .filter((field) => field.field === 4 && field.wire === 2)
      .map((field) =>
        protoText(
          readProtoFields(field.value as Buffer).find(
            (inner) => inner.field === 2,
          ),
        ),
      )
      .filter((name): name is string => Boolean(name));
    const albumArtists = albumFields
      .filter((field) => field.field === 3 && field.wire === 2)
      .map((field) =>
        protoText(
          readProtoFields(field.value as Buffer).find(
            (inner) => inner.field === 2,
          ),
        ),
      )
      .filter((name): name is string => Boolean(name));
    const durationRaw = protoNumber(fields.find((field) => field.field === 7));
    const durationMs = durationRaw === null ? 0 : zigzagNumber(durationRaw);
    tracks.push({
      id,
      title,
      artist: (artists.length > 0 ? artists : albumArtists).join(", "),
      album: album ?? "",
      durationMs,
      coverUrl: readCoverUrl(covers.get(id)),
      addedAt: 0,
    });
  }

  return { tracks, source: directory, missingMetadata };
}

/** Read the collection artist list from a Spotify desktop cache folder. */
export function readSpotifyDesktopFollowedArtists(): SpotifyDesktopCollection | null {
  const directory = databaseDirectory();
  if (!directory) return null;
  const entries = readDatabaseEntries(directory);
  if (!entries) return null;

  const artists = new Map<string, SpotifyDesktopArtist>();
  for (const entry of entries.values()) {
    if (!entry.key.includes("col#art")) continue;
    if (entry.value.length === 0) continue;
    const match = ARTIST_KEY.exec(entry.key);
    if (!match) continue;
    const name =
      entry.key.includes("col#art.ar#%spotify:artist:")
        ? parseProtoString(entry.value) ?? ""
        : "";
    const current = artists.get(match[1]);
    if (!current || (!current.name && name)) {
      artists.set(match[1], { id: match[1], name: name || current?.name || "" });
    }
  }

  return {
    artists: [...artists.values()].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    ),
    source: directory,
  };
}
