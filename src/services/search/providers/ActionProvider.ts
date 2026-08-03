import { CATEGORY_TITLES } from '../../actions/types.js';
import { LABEL_FIELD, SearchService } from '../../SearchService.js';
import type { SearchHit, SearchProvider } from '../types.js';

/**
 * Workspace actions as palette results.
 *
 * Browsable, so the Actions tab exists before anything is typed: an action
 * nobody can see until they guess a matching word is not discoverable, which
 * was the whole reason for the tab.
 *
 * Ranking runs through SearchService like every other provider, so actions
 * obey the same tier rules as projects and sessions. Ordering after that is
 * the registry's: FilterService keeps caller order inside a tier, so an
 * empty query lists the categories exactly as CATEGORY_ORDER laid them out.
 */
export const ActionProvider: SearchProvider = {
  id: 'actions',
  kind: 'action',
  title: 'Actions',
  browsable: true,

  enabled: (context) => context.actions.length > 0,

  async search(query, context) {
    const results = SearchService.filterActions(context.actions, query);

    // Section headers only make sense while the rows are still in registry
    // order. Once a query reshuffles them by score, a category can appear
    // twice, so the headers come off and the titles carry the grouping.
    const grouped = query.trim() === '';

    return results.map((result): SearchHit => {
      const action = result.item;
      return {
        id: `action:${action.id}`,
        kind: 'action',
        title: action.title,
        highlights: result.highlights[LABEL_FIELD],
        subtitle: action.subtitle,
        section: grouped ? CATEGORY_TITLES[action.category] : undefined,
        // State goes in the meta column rather than a check glyph. Modal
        // rows pad their opaque background with text.length, so an
        // ambiguous-width character would leak the interface behind the row
        // in terminals that render it double width.
        meta: action.active ? 'active' : undefined,
        danger: action.danger,
        score: result.score,
        target: { kind: 'action', id: action.id },
      };
    });
  },
};
