import type { Project } from './DiscoveryService.js';
import type { SessionMetadata } from './SessionMetadataService.js';
import type { SessionEntry } from './SessionService.js';

/**
 * Fields a session can be matched on. Kept as an explicit list so a future
 * full-text index can extend matching without changing call sites.
 */
export interface SessionSearchDocument {
  id: string;
  title: string;
  projectPath: string;
  encoded: string;
  gitBranch?: string;
  /** Reserved for a future content index: prompts, summaries, file names. */
  keywords?: string[];
}

export function toSearchDocument(
  session: SessionEntry,
  metadata: SessionMetadata | undefined,
  projectPath: string,
): SessionSearchDocument {
  return {
    id: session.id,
    title: metadata?.title ?? session.id,
    projectPath: metadata?.cwd ?? projectPath,
    encoded: session.encoded,
    gitBranch: metadata?.gitBranch,
  };
}

/**
 * Substring matching over session and project fields.
 *
 * The interface intentionally takes documents rather than raw sessions:
 * when an on-disk content index lands, it can populate `keywords` and
 * everything downstream keeps working unchanged.
 */
class SearchServiceImpl {
  /** True when every whitespace-separated term matches some field. */
  matchesSession(document: SessionSearchDocument, query: string): boolean {
    const terms = tokenize(query);
    if (terms.length === 0) return true;
    const haystack = [
      document.title,
      document.id,
      document.projectPath,
      document.encoded,
      document.gitBranch ?? '',
      ...(document.keywords ?? []),
    ]
      .join('\n')
      .toLowerCase();
    return terms.every((term) => haystack.includes(term));
  }

  matchesProject(project: Project, query: string): boolean {
    const terms = tokenize(query);
    if (terms.length === 0) return true;
    const haystack = `${project.path}\n${project.encoded}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  }

  filterSessions(
    sessions: SessionEntry[],
    metadata: Map<string, SessionMetadata>,
    projectPath: string,
    query: string,
  ): SessionEntry[] {
    if (!query.trim()) return sessions;
    return sessions.filter((session) =>
      this.matchesSession(toSearchDocument(session, metadata.get(session.file), projectPath), query),
    );
  }

  filterProjects(projects: Project[], query: string): Project[] {
    if (!query.trim()) return projects;
    return projects.filter((project) => this.matchesProject(project, query));
  }
}

export const SearchService = new SearchServiceImpl();

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0);
}
