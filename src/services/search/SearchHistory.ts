const LIMIT = 10;

/**
 * Recent palette queries, for the process lifetime only.
 *
 * Deliberately not persisted: this exists to make a second search in the
 * same sitting cheap, not to build a profile across runs.
 *
 * It lives in a service rather than in palette state because the palette
 * unmounts every time it closes, and only queries that produced a jump are
 * recorded, which is what keeps abandoned half-typed prefixes out.
 */
class SearchHistoryImpl {
  private queries: string[] = [];

  record(query: string): void {
    const trimmed = query.trim();
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    this.queries = [trimmed, ...this.queries.filter((q) => q.toLowerCase() !== lower)].slice(
      0,
      LIMIT,
    );
  }

  list(): string[] {
    return [...this.queries];
  }

  clear(): void {
    this.queries = [];
  }
}

export const SearchHistory = new SearchHistoryImpl();
