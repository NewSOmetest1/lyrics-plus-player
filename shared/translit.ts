/**
 * Algorithmic Cyrillic → Latin transliteration and phonetic comparison.
 *
 * No artist dictionaries: names are transliterated by rule and reduced to a
 * phonetic key before fuzzy comparison, so spelling variants such as
 * "Валентин Стрыкало" / "Valentin Strykalo" meet in the same space.
 */

const MULTI_LETTER_RULES: Array<[string, string]> = [
  ["дж", "dj"],
  ["дз", "dz"],
  ["шч", "shch"],
];

const SINGLE_LETTER_RULES: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  ґ: "g",
  д: "d",
  е: "e",
  ё: "yo",
  ж: "zh",
  з: "z",
  и: "y",
  і: "i",
  ї: "yi",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "kh",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "shch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
  є: "ye",
};

const LETTER_KEY_CACHE = new Map<string, string>();
const MATCH_CACHE = new Map<string, boolean>();

/** Transliterate Russian and Ukrainian Cyrillic into lowercase Latin. */
export function transliterateToLatin(value: string): string {
  const source = String(value ?? "")
    .normalize("NFC")
    .toLocaleLowerCase();
  let result = "";

  for (let index = 0; index < source.length; index += 1) {
    const pair = source.slice(index, index + 2);
    const multi = MULTI_LETTER_RULES.find(([from]) => from === pair);
    if (multi) {
      result += multi[1];
      index += 1;
      continue;
    }

    const char = source[index]!;
    const mapped = SINGLE_LETTER_RULES[char];
    result += mapped ?? char;
  }

  return result;
}

/**
 * Reduce a transliterated artist name to a compact phonetic key:
 * y→i, w→v, collapse repeated letters and remove separators.
 */
export function phoneticClean(value: string): string {
  return String(value ?? "")
    .toLocaleLowerCase()
    .replace(/y/g, "i")
    .replace(/w/g, "v")
    // "zh" and soft "g" (g before e/i) are the same /dʒ/-like sound.
    // This is what lets rule-based "vintazh" meet English "vintage".
    .replace(/zh/g, "j")
    .replace(/g(?=[ei])/g, "j")
    .replace(/([a-z])\1+/g, "$1")
    .replace(/[^a-z0-9]/g, "");
}

/** Phonetic key for an artist or a single artist credit. */
export function artistPhoneticKey(value: string): string {
  const source = String(value ?? "").trim();
  const cached = LETTER_KEY_CACHE.get(source);
  if (cached !== undefined) return cached;
  const key = phoneticClean(transliterateToLatin(source));
  LETTER_KEY_CACHE.set(source, key);
  return key;
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  let current = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        substitution,
      );
    }
    [previous, current] = [current, previous];
  }

  return previous[b.length]!;
}

/** Normalized Levenshtein similarity in the [0, 1] range. */
export function levenshteinSimilarity(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const longest = Math.max(a.length, b.length);
  return 1 - levenshteinDistance(a, b) / longest;
}

function basicNormalize(value: string): string {
  return String(value ?? "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Compare two artist names across scripts. Exact normalized names, dictionary
 * membership (none by design), transliterated equality, substring inclusion
 * for featured credits, and finally 80% phonetic Levenshtein similarity.
 */
export function areArtistsMatching(
  artistA: string,
  artistB: string,
): boolean {
  const rawA = String(artistA ?? "").trim();
  const rawB = String(artistB ?? "").trim();
  if (!rawA || !rawB) return false;

  if (basicNormalize(rawA) === basicNormalize(rawB)) return true;

  const keyA = artistPhoneticKey(rawA);
  const keyB = artistPhoneticKey(rawB);
  if (!keyA || !keyB) return false;
  if (keyA === keyB) return true;

  const cacheKey = keyA <= keyB ? `${keyA}\u0000${keyB}` : `${keyB}\u0000${keyA}`;
  const cached = MATCH_CACHE.get(cacheKey);
  if (cached !== undefined) return cached;

  const shorter = keyA.length <= keyB.length ? keyA : keyB;
  const longer = keyA.length <= keyB.length ? keyB : keyA;
  const matched =
    (shorter.length >= 3 && longer.includes(shorter)) ||
    levenshteinSimilarity(keyA, keyB) >= 0.8;
  MATCH_CACHE.set(cacheKey, matched);
  return matched;
}
