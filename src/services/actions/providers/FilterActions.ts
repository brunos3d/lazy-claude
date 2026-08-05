import { PROJECT_FILTERS } from '../../ViewService.js';
import type { ActionProvider, ActionSpec } from '../types.js';

/**
 * Saved views over the workspace.
 *
 * Only predicates that cannot be expressed as an ordering live here. "Large
 * sessions", "recently modified" and "highest storage usage" are all sorts:
 * hiding everything past a threshold is strictly worse than putting the same
 * rows on top and leaving the rest reachable.
 *
 * Each project filter toggles, so running the active one turns it off. A
 * filter that can only be replaced and never released strands the user in a
 * subset of their workspace.
 */
export const FilterActions: ActionProvider = {
  id: 'filter',
  category: 'filter',

  list(context) {
    const { view, showArchived } = context;

    const archived: ActionSpec = {
      id: 'filter.archived',
      title: 'Show archived sessions',
      subtitle: showArchived
        ? 'Currently showing the archive'
        : 'Currently showing live sessions',
      keywords: ['archive', 'archived', 'hidden', 'live', 'toggle', 'restore'],
      active: showArchived,
      run: context.handlers.toggleArchived,
    };

    const projects: ActionSpec[] = PROJECT_FILTERS.map((option) => ({
      id: `filter.projects.${option.id}`,
      title: option.label,
      subtitle: option.description,
      keywords: ['filter', 'only', 'show', 'projects', ...(option.keywords ?? [])],
      active: view.projectFilter === option.id,
      run: () =>
        context.setView({
          ...view,
          projectFilter: view.projectFilter === option.id ? 'none' : option.id,
        }),
    }));

    // Listed only when it would do something. An always-present "clear" that
    // clears nothing is noise in every search that happens to match it.
    const clear: ActionSpec[] =
      view.projectFilter === 'none'
        ? []
        : [
            {
              id: 'filter.clear',
              title: 'Clear project filter',
              subtitle: 'Show every project again',
              keywords: ['reset', 'all', 'remove', 'filter'],
              run: () => context.setView({ ...view, projectFilter: 'none' }),
            },
          ];

    return [archived, ...projects, ...clear];
  },
};
