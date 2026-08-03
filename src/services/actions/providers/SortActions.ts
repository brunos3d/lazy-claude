import { PROJECT_SORTS, SESSION_SORTS, ViewService } from '../../ViewService.js';
import type { ActionProvider, ActionSpec } from '../types.js';

/**
 * Sorting, generated from the tables in ViewService.
 *
 * The sidebar popup reads the same tables, so a new sort is one row there
 * and reaches both surfaces already wired. Nothing about an ordering is
 * described twice.
 */

/** "Largest size" -> "largest size", but "Title A to Z" keeps its A and Z. */
function decapitalize(label: string): string {
  return label.charAt(0).toLowerCase() + label.slice(1);
}

export const SortActions: ActionProvider = {
  id: 'sort',
  category: 'sort',

  list(context) {
    const activeSession = ViewService.sessionSortOption(context.view.sessionSort).id;
    const activeProject = ViewService.projectSortOption(context.view.projectSort).id;

    const sessions: ActionSpec[] = SESSION_SORTS.map((option) => ({
      id: `sort.sessions.${option.id}`,
      title: `Sort sessions by ${decapitalize(option.label)}`,
      subtitle: 'Sessions list order',
      keywords: ['sort', 'order', 'sessions', ...(option.keywords ?? [])],
      active: activeSession === option.id,
      run: () => context.setView({ ...context.view, sessionSort: option.sort }),
    }));

    const projects: ActionSpec[] = PROJECT_SORTS.map((option) => ({
      id: `sort.projects.${option.id}`,
      title: `Sort projects by ${decapitalize(option.label)}`,
      subtitle: 'Projects list order',
      keywords: ['sort', 'order', 'projects', ...(option.keywords ?? [])],
      active: activeProject === option.id,
      run: () => context.setView({ ...context.view, projectSort: option.sort }),
    }));

    return [...sessions, ...projects];
  },
};
