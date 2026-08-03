import { formatRelativeTime, shortenPath } from '../../../core/format.js';
import { LABEL_FIELD, SearchService } from '../../SearchService.js';
import type { SearchHit, SearchProvider } from '../types.js';

/**
 * Projects, matched the same way the Projects panel matches them.
 *
 * Delegates to SearchService so there stays exactly one fuzzy
 * implementation in the codebase: a divergence here would mean the palette
 * and the panel disagree about what a query means.
 */
export const ProjectProvider: SearchProvider = {
  id: 'projects',
  kind: 'project',
  title: 'Projects',
  limit: 6,

  enabled: (context) => context.index.projects.length > 0,

  async search(query, context) {
    const { index } = context;
    return SearchService.filterProjects(index.projects, query, index.home).map(
      (result): SearchHit => {
        const project = result.item;
        const parts = [`${project.sessions} session${project.sessions === 1 ? '' : 's'}`];
        if (project.lastActivity > 0) {
          parts.push(formatRelativeTime(new Date(project.lastActivity * 1000)));
        }
        return {
          id: `project:${project.encoded}`,
          kind: 'project',
          title: project.orphaned ? project.encoded : shortenPath(project.path, index.home),
          highlights: result.highlights[LABEL_FIELD],
          subtitle: project.orphaned ? 'orphaned session folder' : project.path,
          meta: parts.join(' · '),
          score: result.score,
          target: { kind: 'project', encoded: project.encoded },
        };
      },
    );
  },
};
