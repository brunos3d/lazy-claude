import { fuzzyMatch } from '../core/fuzzy.js';

/**
 * One searchable attribute of an item. Adding a new way to find something
 * means appending a field here, not touching any panel or command: this is
 * where future indexed data (conversation summaries, modified files, tags,
 * technologies) plugs in.
 */
export interface SearchField {
  key: string;
  value: string;
  /** Multiplier on this field's score, so titles can outrank ids. */
  weight: number;
  /** Return match positions for this field so the UI can highlight them. */
  highlight?: boolean;
}

export interface SearchDocument<T> {
  item: T;
  fields: SearchField[];
}

export interface SearchResult<T> {
  item: T;
  score: number;
  /** Match positions per field key, only for fields marked `highlight`. */
  highlights: Record<string, number[]>;
}

/**
 * How directly a query hit a field, independent of fuzzy score.
 *
 * Fuzzy subsequence scoring alone lets a long scattered match outrank a
 * short literal one, which reads as broken: typing a project's exact name
 * should never bury it. Tiers dominate the score so that ordering is
 * guaranteed, and the fuzzy score only decides ties inside a tier.
 */
export type MatchTier = 0 | 1 | 2 | 3;

export function matchTier(value: string, query: string): MatchTier {
  const haystack = value.toLowerCase();
  const needle = query.toLowerCase();
  if (haystack === needle) return 3;
  if (haystack.startsWith(needle)) return 2;
  if (haystack.includes(needle)) return 1;
  return 0;
}

/**
 * Larger than any reachable fuzzy score. `core/fuzzy.ts` caps a character
 * at SCORE_MATCH + BONUS_BOUNDARY + BONUS_FIRST_CHAR + BONUS_CONSECUTIVE,
 * so no realistic query gets near this and tiers stay strictly separated.
 */
export const TIER_WEIGHT = 10000;

/**
 * Generic fuzzy filtering over documents.
 *
 * An item's score is the best score across its fields, so a strong title
 * match beats a weak path match. Ties keep the caller's original order,
 * which matters because the lists arrive sorted by recency.
 */
class FilterServiceImpl {
  filter<T>(documents: Array<SearchDocument<T>>, query: string): Array<SearchResult<T>> {
    const trimmed = query.trim();
    if (!trimmed) {
      return documents.map((document) => ({ item: document.item, score: 0, highlights: {} }));
    }

    const scored: Array<{ result: SearchResult<T>; index: number }> = [];

    documents.forEach((document, index) => {
      let best = Number.NEGATIVE_INFINITY;
      const highlights: Record<string, number[]> = {};

      for (const field of document.fields) {
        if (!field.value) continue;
        const match = fuzzyMatch(field.value, trimmed);
        if (!match) continue;
        const weighted =
          matchTier(field.value, trimmed) * TIER_WEIGHT + match.score * field.weight;
        if (weighted > best) best = weighted;
        if (field.highlight) highlights[field.key] = match.positions;
      }

      if (best > Number.NEGATIVE_INFINITY) {
        scored.push({ result: { item: document.item, score: best, highlights }, index });
      }
    });

    scored.sort((a, b) => (b.result.score - a.result.score) || (a.index - b.index));
    return scored.map((entry) => entry.result);
  }
}

export const FilterService = new FilterServiceImpl();
