import { formatRelativeTime } from '../../../core/format.js';
import { LABEL_FIELD, SearchService } from '../../SearchService.js';
import type { SearchHit, SearchProvider } from '../types.js';

/**
 * Sessions from every project, live and archived.
 *
 * Project path stays out of the match fields, as it does in the panel.
 * Fuzzy subsequence matching against long absolute paths matches almost
 * anything, and globally a single high-session-count project would drown
 * every real title hit. The project is shown as context, not matched on.
 */
export const SessionProvider: SearchProvider = {
  id: 'sessions',
  kind: 'session',
  title: 'Sessions',
  limit: 12,

  enabled: (context) => context.index.sessions.length > 0,

  async search(query, context) {
    const { index } = context;
    return SearchService.filterSessions(index.sessions, index.metadata, query).map(
      (result): SearchHit => {
        const session = result.item;
        const parts = [formatRelativeTime(session.modifiedAt)];
        if (session.archived) parts.push('archived');
        return {
          id: `session:${session.file}`,
          kind: 'session',
          title: index.metadata.get(session.file)?.title ?? session.id,
          highlights: result.highlights[LABEL_FIELD],
          subtitle: index.projectLabels.get(session.encoded) ?? session.encoded,
          meta: parts.join(' · '),
          score: result.score,
          target: {
            kind: 'session',
            encoded: session.encoded,
            file: session.file,
            archived: session.archived,
          },
        };
      },
    );
  },
};
