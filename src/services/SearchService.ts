import os from 'node:os';
import { shortenPath } from '../core/format.js';
import { FilterService, type SearchDocument, type SearchResult } from './FilterService.js';
import type { Project } from './DiscoveryService.js';
import type { SessionMetadata } from './SessionMetadataService.js';
import type { SessionEntry } from './SessionService.js';

/**
 * Domain document builders. Each panel describes what its items are
 * searchable by; the ranking itself lives in FilterService, so Projects,
 * Sessions, and any future list share one implementation.
 *
 * The `label` field is what the list actually displays, and it is the only
 * one marked for highlighting, so highlight positions always line up with
 * the rendered text.
 */

export const LABEL_FIELD = 'label';

export function projectDocument(project: Project, home: string): SearchDocument<Project> {
  const label = project.orphaned ? project.encoded : shortenPath(project.path, home);
  return {
    item: project,
    fields: [
      { key: LABEL_FIELD, value: label, weight: 1, highlight: true },
      { key: 'path', value: project.path, weight: 0.6 },
      { key: 'encoded', value: project.encoded, weight: 0.4 },
    ],
  };
}

/**
 * Sessions match on their own identity: title, branch, and id.
 *
 * The project path is deliberately not a match field. Fuzzy subsequence
 * matching against long absolute paths matches almost anything ("clm"
 * matches `/home/user/.claude-mem/...`, which alone owns hundreds of
 * sessions), so including it drowned real title hits. Narrowing by
 * project is what the Projects panel is for.
 */
export function sessionDocument(
  session: SessionEntry,
  metadata: SessionMetadata | undefined,
): SearchDocument<SessionEntry> {
  const title = metadata?.title ?? session.id;
  return {
    item: session,
    fields: [
      { key: LABEL_FIELD, value: title, weight: 1, highlight: true },
      { key: 'branch', value: metadata?.gitBranch ?? '', weight: 0.7 },
      { key: 'id', value: session.id, weight: 0.6 },
      // Future indexed content (prompts, summaries, modified files, tags)
      // becomes additional fields here with no change to callers.
    ],
  };
}

class SearchServiceImpl {
  filterProjects(projects: Project[], query: string, home = os.homedir()): Array<SearchResult<Project>> {
    return FilterService.filter(
      projects.map((project) => projectDocument(project, home)),
      query,
    );
  }

  filterSessions(
    sessions: SessionEntry[],
    metadata: Map<string, SessionMetadata>,
    query: string,
  ): Array<SearchResult<SessionEntry>> {
    return FilterService.filter(
      sessions.map((session) => sessionDocument(session, metadata.get(session.file))),
      query,
    );
  }

  /** Single-session predicate, used by the CLI search command. */
  matchesSession(
    session: SessionEntry,
    metadata: SessionMetadata | undefined,
    query: string,
  ): boolean {
    return FilterService.filter([sessionDocument(session, metadata)], query).length > 0;
  }
}

export const SearchService = new SearchServiceImpl();
