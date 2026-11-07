import type { AlbumGroup, ArtistGroup, Track } from "@/types";
import { coverUrl } from "@/lib/api";

const ARTIST_SEPARATOR = /\s*[,;&]\s*/;

/**
 * "Anguish, ily & Lieless", "A feat. B", "A / B" and "A w/ B" all become
 * individual artist names.
 */
export function splitArtistNames(value: string): string[] {
  const normalized = value
    .replace(/\bw\/\s*/gi, " & ")
    .replace(/\s+\b(?:feat(?:uring)?|ft|vs)\.?\s+/gi, " & ")
    .replace(/\s*\/\s*/g, " & ")
    .trim();
  if (!normalized) return [];

  const seen = new Set<string>();
  const names: string[] = [];
  for (const part of normalized.split(ARTIST_SEPARATOR)) {
    const name = part.replace(/\s+/g, " ").trim();
    if (!name) continue;
    const key = name.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

function preferredCoverTrack(tracks: Track[]): Track {
  return (
    tracks.find((track) => track.coverFullPath || track.coverPath) ?? tracks[0]
  );
}

function compareTracks(a: Track, b: Track): number {
  const album = a.album.localeCompare(b.album, undefined, {
    sensitivity: "base",
  });
  if (album !== 0) return album;

  const year = (a.year ?? 0) - (b.year ?? 0);
  if (year !== 0) return year;

  const trackNo = (a.trackNo ?? 0) - (b.trackNo ?? 0);
  if (trackNo !== 0) return trackNo;

  return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
}

/**
 * Aggregate every unique performer across the local library. Collaborations
 * are split into individual artists, so one track can belong to several
 * artist groups (for example "Anguish, ily & Lieless").
 */
export function buildArtistGroups(tracks: Track[]): ArtistGroup[] {
  const buckets = new Map<
    string,
    { variants: Map<string, number>; tracks: Map<number, Track> }
  >();

  for (const track of tracks) {
    const names = splitArtistNames(track.artist);
    const artists = names.length > 0 ? names : ["Unknown artist"];

    for (const rawName of artists) {
      const key = rawName.toLocaleLowerCase();
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { variants: new Map(), tracks: new Map() };
        buckets.set(key, bucket);
      }
      bucket.variants.set(
        rawName,
        (bucket.variants.get(rawName) ?? 0) + 1,
      );
      bucket.tracks.set(track.id, track);
    }
  }

  const groups: ArtistGroup[] = [];
  for (const bucket of buckets.values()) {
    let name = "";
    let best = -1;
    for (const [variant, count] of bucket.variants) {
      if (
        count > best ||
        (count === best &&
          variant.localeCompare(name, undefined, { sensitivity: "base" }) < 0)
      ) {
        name = variant;
        best = count;
      }
    }

    const artistTracks = [...bucket.tracks.values()].sort(compareTracks);
    const coverTrack = preferredCoverTrack(artistTracks);
    const albums = new Set(
      artistTracks
        .map((track) => track.album.trim().toLocaleLowerCase())
        .filter(Boolean),
    );

    groups.push({
      name,
      trackCount: artistTracks.length,
      albumCount: albums.size,
      coverUrl: coverUrl(coverTrack, true) ?? undefined,
      coverTrack,
      tracks: artistTracks,
    });
  }

  return groups.sort(
    (a, b) =>
      b.trackCount - a.trackCount ||
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

/** Group tracks into album cards for the Albums library filter. */
export function buildAlbumGroups(tracks: Track[]): AlbumGroup[] {
  const buckets = new Map<
    string,
    {
      album: string;
      artist: string;
      tracks: Map<number, Track>;
    }
  >();

  for (const track of tracks) {
    const album = track.album.trim() || "Unknown album";
    const artist =
      track.albumArtist?.trim() || track.artist.trim() || "Unknown artist";
    const key = `${album.toLocaleLowerCase()}\u0000${artist.toLocaleLowerCase()}`;

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { album, artist, tracks: new Map() };
      buckets.set(key, bucket);
    }
    bucket.tracks.set(track.id, track);
  }

  const groups: AlbumGroup[] = [];
  for (const [key, bucket] of buckets) {
    const albumTracks = [...bucket.tracks.values()].sort(compareTracks);
    const coverTrack = preferredCoverTrack(albumTracks);
    groups.push({
      key,
      album: bucket.album,
      artist: bucket.artist,
      trackCount: albumTracks.length,
      coverUrl: coverUrl(coverTrack, true) ?? undefined,
      coverTrack,
      tracks: albumTracks,
    });
  }

  return groups.sort(
    (a, b) =>
      a.album.localeCompare(b.album, undefined, { sensitivity: "base" }) ||
      a.artist.localeCompare(b.artist, undefined, { sensitivity: "base" }),
  );
}
