import type { ActionProvider } from '../types.js';

/**
 * One report, not eight commands.
 *
 * "Largest sessions", "storage usage", "archived count" and "average session
 * size" are rows of the same summary. Splitting them into separate palette
 * entries would mean four ways to open one overlay.
 */
export const InsightActions: ActionProvider = {
  id: 'insight',
  category: 'insight',

  list(context) {
    return [
      {
        id: 'insight.statistics',
        title: 'Workspace statistics',
        subtitle: 'Storage, counts, and the largest projects and sessions',
        keywords: [
          'stats',
          'statistics',
          'storage',
          'usage',
          'size',
          'largest',
          'biggest',
          'count',
          'archived',
          'average',
          'oldest',
          'newest',
          'summary',
          'report',
          'disk',
        ],
        run: context.handlers.statistics,
      },
    ];
  },
};
