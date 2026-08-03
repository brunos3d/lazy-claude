/**
 * Fuzzy subsequence matching with fzf-style scoring.
 *
 * A pattern matches when its characters appear in order, not necessarily
 * adjacently, so "lz" matches "lazy-claude" and "vrt" matches
 * "vortex-platform". Ranking rewards matches that a human would consider
 * the obvious one: consecutive runs, characters at the start of a path or
 * word segment, and matches near the beginning of the text.
 */

const SCORE_MATCH = 16;
const BONUS_BOUNDARY = 10;
const BONUS_CAMEL = 6;
const BONUS_CONSECUTIVE = 8;
const BONUS_FIRST_CHAR = 12;
const PENALTY_GAP_START = -3;
const PENALTY_GAP_EXTENSION = -1;

export interface FuzzyMatch {
  score: number;
  /** Indices in the haystack that the pattern matched, ascending. */
  positions: number[];
}

const SEPARATORS = new Set(['/', '\\', '-', '_', '.', ' ', ':', '@']);

function isBoundary(text: string, index: number): boolean {
  if (index === 0) return true;
  return SEPARATORS.has(text[index - 1]);
}

function isCamel(text: string, index: number): boolean {
  if (index === 0) return false;
  const previous = text[index - 1];
  const current = text[index];
  return previous === previous.toLowerCase() && current === current.toUpperCase();
}

/** Per-character bonus that does not depend on the pattern. */
function positionBonus(text: string, index: number): number {
  if (isBoundary(text, index)) return index === 0 ? BONUS_BOUNDARY + BONUS_FIRST_CHAR : BONUS_BOUNDARY;
  if (isCamel(text, index)) return BONUS_CAMEL;
  return 0;
}

/**
 * Score `pattern` against `text`, returning null when the pattern is not a
 * subsequence. An empty pattern matches everything with score 0.
 *
 * Uses dynamic programming over (pattern index, text index) so the best
 * alignment wins rather than the first greedy one: for "clamp" against
 * "claude-move-project/clamp" the trailing exact run outranks the
 * scattered prefix match.
 */
export function fuzzyMatch(text: string, pattern: string): FuzzyMatch | null {
  if (pattern.length === 0) return { score: 0, positions: [] };
  if (pattern.length > text.length) return null;

  const haystack = text.toLowerCase();
  const needle = pattern.toLowerCase();

  // Cheap rejection: every pattern char must appear in order at all.
  let probe = 0;
  for (let i = 0; i < haystack.length && probe < needle.length; i++) {
    if (haystack[i] === needle[probe]) probe += 1;
  }
  if (probe < needle.length) return null;

  const n = haystack.length;
  const m = needle.length;
  const NEG = Number.NEGATIVE_INFINITY;

  // previous[j] = best score aligning pattern[0..i-1] with text ending at j.
  let previous = new Float64Array(n).fill(NEG);
  const backlinks: Int32Array[] = [];

  for (let i = 0; i < m; i++) {
    const current = new Float64Array(n).fill(NEG);
    const back = new Int32Array(n).fill(-1);
    // Best alignment from the previous row ending strictly before j, with
    // the gap penalty growing as the gap widens.
    let bestPrior = NEG;
    let bestPriorIndex = -1;

    for (let j = 0; j < n; j++) {
      if (i > 0) {
        if (bestPrior > NEG) bestPrior += PENALTY_GAP_EXTENSION;
        if (j > 0 && previous[j - 1] > NEG) {
          const startGap = previous[j - 1] + PENALTY_GAP_START;
          if (startGap > bestPrior) {
            bestPrior = startGap;
            bestPriorIndex = j - 1;
          }
        }
      }

      if (haystack[j] !== needle[i]) continue;

      if (i === 0) {
        // Mild preference for matches nearer the start of the text.
        current[j] = SCORE_MATCH + positionBonus(text, j) - j * 0.5;
        continue;
      }

      let score = NEG;
      let from = -1;
      // Adjacent to the previous match: the strongest signal.
      if (j > 0 && previous[j - 1] > NEG) {
        score = previous[j - 1] + SCORE_MATCH + BONUS_CONSECUTIVE + positionBonus(text, j);
        from = j - 1;
      }
      // Otherwise jump from the best alignment that ended earlier.
      if (bestPrior > NEG) {
        const gapped = bestPrior + SCORE_MATCH + positionBonus(text, j);
        if (gapped > score) {
          score = gapped;
          from = bestPriorIndex;
        }
      }
      if (score > NEG) {
        current[j] = score;
        back[j] = from;
      }
    }

    backlinks.push(back);
    previous = current;
  }

  // Best endpoint on the final row.
  let bestScore = NEG;
  let bestIndex = -1;
  for (let j = 0; j < n; j++) {
    if (previous[j] > bestScore) {
      bestScore = previous[j];
      bestIndex = j;
    }
  }
  if (bestIndex < 0 || bestScore === NEG) return null;

  // Walk the back-pointers to recover the matched indices.
  const positions: number[] = [];
  let index = bestIndex;
  for (let i = m - 1; i >= 0 && index >= 0; i--) {
    positions.push(index);
    index = backlinks[i][index];
  }
  positions.reverse();

  return { score: bestScore, positions };
}

/** True when the pattern matches at all, ignoring score. */
export function fuzzyMatches(text: string, pattern: string): boolean {
  return fuzzyMatch(text, pattern) !== null;
}
