import type { WorkspaceAction } from '../actions/types.js';
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
const GROUP_ORDER: ResultKind[] = ['project', 'session', 'message', 'action'];

/**
 * Runs registered providers against one workspace snapshot.
 *
 * The engine owns the request lifecycle: it builds the SearchContext, owns
 * the AbortController, and aborts the previous run when a new query
 * arrives. Providers never construct either.
 *
 * Groups with no hits are dropped, which is also how a disabled provider
 * stays invisible: the palette derives its tabs from what comes back, so
 * an empty category never gets a tab the user can land on.
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

  async search(
    query: string,
    index: WorkspaceIndex,
    actions: WorkspaceAction[] = [],
  ): Promise<SearchGroup[]> {
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;

    const trimmed = query.trim();
    const context: SearchContext = { index, actions, signal: controller.signal };

    // An empty query runs only the browsable providers, so their tab is
    // there to be discovered before the user has guessed a word that
    // matches. Everything else still costs nothing until something is typed.
    const active = this.providers.filter(
      (provider) => (trimmed !== '' || provider.browsable === true) && provider.enabled(context),
    );
    if (active.length === 0) return [];

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

    // Every hit is kept. The palette scrolls one group at a time in its own
    // tab, so there is nothing to cap: a ceiling here would only make the
    // results past it unreachable.
    const groups: SearchGroup[] = [];
    for (const { provider, hits } of settled) {
      if (hits.length === 0) continue;
      groups.push({ kind: provider.kind, title: provider.title, hits });
    }

    groups.sort((a, b) => GROUP_ORDER.indexOf(a.kind) - GROUP_ORDER.indexOf(b.kind));
    return groups;
  }
}

export const SearchEngine = new SearchEngineImpl();
