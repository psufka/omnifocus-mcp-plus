/**
 * Pure, deterministic string similarity scoring.
 *
 * Used by find_similar_tasks to rank existing OmniFocus task names against a
 * proposed new task name so a model can reuse an existing task instead of
 * creating a near-duplicate. Nothing here touches OmniFocus, the filesystem,
 * or the clock — same inputs always produce the same numbers, which is what
 * makes the scoring unit-testable.
 *
 * The combined score blends three complementary signals:
 *
 *   1. Sørensen–Dice over character bigrams — tolerant of typos and
 *      inflections ("dentist" / "dentists", "milk" / "mlik").
 *   2. Jaccard over lowercased word tokens — order-insensitive, so
 *      "weekly plan review" matches "review weekly plan".
 *   3. A substring containment bonus — a short query fully contained in a
 *      longer name ("call dentist" inside "call dentist about the crown") is
 *      highly relevant even though bigram overlap is diluted by the extra
 *      words.
 *
 * Dice and Jaccard are weighted 0.55 / 0.45 so two identical strings score
 * exactly 1.0 before the bonus; the sum is clamped to [0, 1].
 */

const DICE_WEIGHT = 0.55;
const JACCARD_WEIGHT = 0.45;

/** Flat bonus added when the shorter normalized string is a substring of the longer. */
export const CONTAINMENT_BONUS = 0.15;

/**
 * Containment below this many characters is noise ("a" is inside almost
 * everything), so the bonus is withheld for very short strings.
 */
const MIN_CONTAINMENT_LENGTH = 4;

const COMBINING_MARKS = /[\u0300-\u036f]/g;
const NON_ALPHANUMERIC = /[^\p{L}\p{N}]+/gu;

/**
 * Lowercase, strip diacritics and emoji, and reduce every run of punctuation
 * or whitespace to a single space. "Réview  Q3 — plan!" -> "review q3 plan".
 */
export function normalizeForSimilarity(input: string): string {
  if (typeof input !== 'string') return '';
  return input
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(NON_ALPHANUMERIC, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Word tokens of the normalized string. Empty input yields an empty array. */
export function tokenize(input: string): string[] {
  const normalized = normalizeForSimilarity(input);
  return normalized === '' ? [] : normalized.split(' ');
}

/**
 * Multiset of character bigrams over an ALREADY-NORMALIZED string. Spaces are
 * kept as characters so word boundaries carry signal. A single-character
 * string yields that character as its only gram, so short names still compare.
 */
export function bigramCounts(normalized: string): Map<string, number> {
  const counts = new Map<string, number>();
  if (normalized.length === 0) return counts;
  if (normalized.length === 1) {
    counts.set(normalized, 1);
    return counts;
  }
  for (let i = 0; i < normalized.length - 1; i++) {
    const gram = normalized.slice(i, i + 2);
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  return counts;
}

function totalCount(counts: Map<string, number>): number {
  let total = 0;
  for (const value of counts.values()) total += value;
  return total;
}

/**
 * Sørensen–Dice coefficient over character bigrams, 0–1.
 * Both strings are normalized first; two empty strings score 0 (there is no
 * evidence of similarity in a pair of blanks).
 */
export function diceCoefficient(a: string, b: string): number {
  const na = normalizeForSimilarity(a);
  const nb = normalizeForSimilarity(b);
  if (na === '' || nb === '') return 0;
  if (na === nb) return 1;

  const countsA = bigramCounts(na);
  const countsB = bigramCounts(nb);
  let intersection = 0;
  for (const [gram, countA] of countsA) {
    const countB = countsB.get(gram);
    if (countB !== undefined) intersection += Math.min(countA, countB);
  }
  const total = totalCount(countsA) + totalCount(countsB);
  return total === 0 ? 0 : (2 * intersection) / total;
}

/** Jaccard index over lowercased word-token SETS, 0–1. Word order is ignored. */
export function tokenJaccard(a: string, b: string): number {
  const tokensA = new Set(tokenize(a));
  const tokensB = new Set(tokenize(b));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) intersection++;
  }
  const union = tokensA.size + tokensB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * CONTAINMENT_BONUS when the shorter normalized string appears verbatim inside
 * the longer one, otherwise 0. Withheld for strings shorter than
 * MIN_CONTAINMENT_LENGTH, where containment is coincidence rather than signal.
 */
export function containmentBonus(a: string, b: string): number {
  const na = normalizeForSimilarity(a);
  const nb = normalizeForSimilarity(b);
  if (na === '' || nb === '') return 0;

  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  if (shorter.length < MIN_CONTAINMENT_LENGTH) return 0;
  return longer.includes(shorter) ? CONTAINMENT_BONUS : 0;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Combined similarity of two strings, 0–1. Symmetric: score(a, b) === score(b, a).
 */
export function similarityScore(a: string, b: string): number {
  const na = normalizeForSimilarity(a);
  const nb = normalizeForSimilarity(b);
  if (na === '' || nb === '') return 0;
  if (na === nb) return 1;

  const combined =
    DICE_WEIGHT * diceCoefficient(na, nb) +
    JACCARD_WEIGHT * tokenJaccard(na, nb) +
    containmentBonus(na, nb);
  return clamp01(combined);
}

export interface SimilarityCandidate {
  id: string;
  name: string;
}

export type Scored<T> = T & { score: number };

export interface RankOptions {
  /** Maximum results returned. Defaults to 5. */
  limit?: number;
  /** Minimum score a candidate must reach to be returned. Defaults to 0.35. */
  minScore?: number;
}

/**
 * Score every candidate against `query`, drop anything below `minScore`, and
 * return the top `limit` in a fully deterministic order: score descending,
 * then name ascending, then id ascending. Ties never depend on input order.
 */
export function rankBySimilarity<T extends SimilarityCandidate>(
  query: string,
  candidates: T[],
  options?: RankOptions
): Array<Scored<T>> {
  const limit = options?.limit ?? 5;
  const minScore = options?.minScore ?? 0.35;

  const scored: Array<Scored<T>> = [];
  for (const candidate of candidates) {
    const score = similarityScore(query, candidate.name);
    if (score >= minScore) scored.push({ ...candidate, score });
  }

  scored.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    if (left.name !== right.name) return left.name < right.name ? -1 : 1;
    if (left.id !== right.id) return left.id < right.id ? -1 : 1;
    return 0;
  });

  return limit > 0 ? scored.slice(0, limit) : scored;
}
