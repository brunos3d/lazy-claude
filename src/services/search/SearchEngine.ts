import type {
  ResultKind,
  SearchContext,
  SearchGroup,
  SearchProvider,
  WorkspaceIndex,
} from './types.js';

/**
 * Presentation order of result groups.
 *
 * This is the engine's decision, not a provider's. A provider describes
 * what it provides; where its group sits is a layout question, and keeping
 * it here means the same query always puts the same kind of result in the
 * same place no matter what order providers registered in.
 */
const GROUP_ORDER: ResultKind[] = ['project', 'session', 'message'];

/**
 * Runs registered providers against one workspace snapshot.
 *
 * The engine owns the request lifecycle: it builds the SearchContext, owns
 * the AbortController, and aborts the previous run when a new query
 * arrives. Providers never construct either.
 */
class SearchEngineImpl {
  private providers: SearchProvider[] = [];
  private controller: AbortController | null = null;

  register(provider: SearchProvider): void {
    this.providers = this.providers.filter((p) => p.id !== provider.id).concat(provider);
  }

  /** Drop every provider and cancel any run in flight. Used by tests. */
  reset(): void {
    this.controller?.abort();
    this.controller = null;
    this.providers = [];
  }

  async search(query: string, index: WorkspaceIndex): Promise<SearchGroup[]> {
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;

    const trimmed = query.trim();
    if (!trimmed) return [];

    const context: SearchContext = { index, signal: controller.signal };
    const active = this.providers.filter((provider) => provider.enabled(context));

    // A provider that throws must not take the palette down with it, and
    // must not deny the other groups their results. Independence is the
    // property that makes running them in parallel safe.
    const settled = await Promise.all(
      active.map(async (provider) => {
        try {
          return { provider, hits: await provider.search(trimmed, context) };
        } catch {
          return { provider, hits: [] };
        }
      }),
    );

    if (controller.signal.aborted) return [];

    const groups: SearchGroup[] = [];
    for (const { provider, hits } of settled) {
      if (hits.length === 0) continue;
      groups.push({
        kind: provider.kind,
        title: provider.title,
        hits: hits.slice(0, provider.limit),
        total: hits.length,
      });
    }

    groups.sort((a, b) => GROUP_ORDER.indexOf(a.kind) - GROUP_ORDER.indexOf(b.kind));
    return groups;
  }
}

export const SearchEngine = new SearchEngineImpl();
