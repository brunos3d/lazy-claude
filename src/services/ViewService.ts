import type { Project } from './DiscoveryService.js';
import type { SessionMetadata } from './SessionMetadataService.js';
import type { SessionEntry } from './SessionService.js';

/**
 * How the workspace is currently being looked at.
 *
 * Sorting and filtering are state, not one-off commands: choosing "largest
 * first" keeps the list that way until something else is chosen. Both the
 * sidebar popup and the command palette mutate this same value, and both
 * read their option lists from the tables below, so there is exactly one
 * implementation of each sort no matter which surface picked it.
 */

export type SortDirection = 'asc' | 'desc';

export interface SessionSort {
  field: 'modified' | 'size' | 'title';
  direction: SortDirection;
}

export interface ProjectSort {
  field: 'activity' | 'sessions' | 'size' | 'name';
  direction: SortDirection;
}

/** Which projects the list shows. Sessions filter through the archive toggle. */
export type ProjectFilter = 'none' | 'missing' | 'orphaned' | 'empty';

export interface WorkspaceView {
  sessionSort: SessionSort;
  projectSort: ProjectSort;
  projectFilter: ProjectFilter;
}

export const DEFAULT_VIEW: WorkspaceView = {
  sessionSort: { field: 'modified', direction: 'desc' },
  projectSort: { field: 'activity', direction: 'desc' },
  projectFilter: 'none',
};

/**
 * A named sort, as offered to the user.
 *
 * The palette's sorting actions and the sidebar's `s` popup are both
 * generated from these tables, so adding a sort is one row here and it
 * appears in both places already wired.
 */
export interface SortOption<T> {
  /** Stable id, used to build the action id and to mark the active entry. */
  id: string;
  label: string;
  /** Short form for the indicator on the panel's search row. */
  badge: string;
  /** Extra words the palette should match. Never displayed. */
  keywords?: string[];
  sort: T;
}

export const SESSION_SORTS: Array<SortOption<SessionSort>> = [
  {
    id: 'recent',
    label: 'Most recent',
    badge: 'recent',
    keywords: ['newest', 'latest', 'date', 'modified', 'time'],
    sort: { field: 'modified', direction: 'desc' },
  },
  {
    id: 'oldest',
    label: 'Oldest',
    badge: 'oldest',
    keywords: ['date', 'modified', 'time', 'stale'],
    sort: { field: 'modified', direction: 'asc' },
  },
  {
    id: 'largest',
    label: 'Largest size',
    badge: 'largest',
    keywords: ['size', 'biggest', 'storage', 'disk', 'heavy'],
    sort: { field: 'size', direction: 'desc' },
  },
  {
    id: 'smallest',
    label: 'Smallest size',
    badge: 'smallest',
    keywords: ['size', 'storage', 'disk', 'empty'],
    sort: { field: 'size', direction: 'asc' },
  },
  {
    id: 'title-asc',
    label: 'Title A to Z',
    badge: 'title',
    keywords: ['alphabetical', 'name'],
    sort: { field: 'title', direction: 'asc' },
  },
  {
    id: 'title-desc',
    label: 'Title Z to A',
    badge: 'title ⇅',
    keywords: ['alphabetical', 'name', 'reverse'],
    sort: { field: 'title', direction: 'desc' },
  },
];

export const PROJECT_SORTS: Array<SortOption<ProjectSort>> = [
  {
    id: 'active',
    label: 'Recently active',
    badge: 'active',
    keywords: ['newest', 'latest', 'date', 'time'],
    sort: { field: 'activity', direction: 'desc' },
  },
  {
    id: 'stale',
    label: 'Least recently active',
    badge: 'stale',
    keywords: ['oldest', 'stale', 'abandoned', 'unused', 'date'],
    sort: { field: 'activity', direction: 'asc' },
  },
  {
    id: 'sessions',
    label: 'Most sessions',
    badge: 'sessions',
    keywords: ['count', 'busiest', 'active'],
    sort: { field: 'sessions', direction: 'desc' },
  },
  {
    id: 'largest',
    label: 'Largest total size',
    badge: 'largest',
    keywords: ['size', 'biggest', 'storage', 'disk', 'usage'],
    sort: { field: 'size', direction: 'desc' },
  },
  {
    id: 'name',
    label: 'Name A to Z',
    badge: 'name',
    keywords: ['alphabetical', 'path', 'title'],
    sort: { field: 'name', direction: 'asc' },
  },
];

export interface FilterOption {
  id: ProjectFilter;
  label: string;
  /** Shown in the panel title while active, so it can never be silently on. */
  badge: string;
  description: string;
  keywords?: string[];
}

/** `none` is the absence of a filter, so it is not offered as one. */
export const PROJECT_FILTERS: FilterOption[] = [
  {
    id: 'missing',
    label: 'Only projects missing on disk',
    badge: 'missing',
    description: 'Directory is gone but its sessions remain',
    keywords: ['broken', 'repair', 'references', 'moved', 'deleted', 'gone'],
  },
  {
    id: 'orphaned',
    label: 'Only orphaned projects',
    badge: 'orphaned',
    description: 'Session folders with no resolvable project path',
    keywords: ['unknown', 'prune', 'dangling'],
  },
  {
    id: 'empty',
    label: 'Only empty projects',
    badge: 'empty',
    description: 'Projects with no live sessions left',
    keywords: ['unused', 'zero', 'cleanup', 'remove'],
  },
];

/** The label a project sorts and displays under. */
function projectName(project: Project): string {
  return project.orphaned ? project.encoded : project.path;
}

function direction(order: SortDirection): number {
  return order === 'asc' ? 1 : -1;
}

/**
 * Every sort copies its input and leaves ties in the caller's order.
 * Array.prototype.sort is stable, so a secondary key would only add a way
 * for the two lists to disagree.
 */
export const ViewService = {
  sortSessions(
    sessions: SessionEntry[],
    metadata: Map<string, SessionMetadata>,
    sort: SessionSort,
  ): SessionEntry[] {
    const sign = direction(sort.direction);
    // Title sorting has to work before metadata arrives, and the rows show
    // the session id until it does. Sorting on that same fallback keeps the
    // order the user sees consistent with the order they asked for.
    const label = (session: SessionEntry) =>
      (metadata.get(session.file)?.title ?? session.id).toLowerCase();

    return [...sessions].sort((a, b) => {
      switch (sort.field) {
        case 'size':
          return sign * (a.sizeBytes - b.sizeBytes);
        case 'title':
          return sign * label(a).localeCompare(label(b));
        case 'modified':
        default:
          return sign * (a.modifiedAt.getTime() - b.modifiedAt.getTime());
      }
    });
  },

  sortProjects(projects: Project[], sort: ProjectSort): Project[] {
    const sign = direction(sort.direction);

    return [...projects].sort((a, b) => {
      switch (sort.field) {
        case 'sessions':
          return sign * (a.sessions - b.sessions);
        case 'size':
          return sign * (a.sessionSizeKb - b.sessionSizeKb);
        case 'name':
          return sign * projectName(a).toLowerCase().localeCompare(projectName(b).toLowerCase());
        case 'activity':
        default:
          return sign * (a.lastActivity - b.lastActivity);
      }
    });
  },

  filterProjects(projects: Project[], filter: ProjectFilter): Project[] {
    switch (filter) {
      case 'missing':
        // The same predicate RepairService works from: a project whose
        // directory is gone but whose path is still known.
        return projects.filter((project) => !project.exists && !project.orphaned);
      case 'orphaned':
        return projects.filter((project) => project.orphaned);
      case 'empty':
        return projects.filter((project) => project.sessions === 0);
      case 'none':
      default:
        return projects;
    }
  },

  sessionSortOption(sort: SessionSort): SortOption<SessionSort> {
    return SESSION_SORTS.find((option) => matches(option.sort, sort)) ?? SESSION_SORTS[0];
  },

  projectSortOption(sort: ProjectSort): SortOption<ProjectSort> {
    return PROJECT_SORTS.find((option) => matches(option.sort, sort)) ?? PROJECT_SORTS[0];
  },

  filterOption(filter: ProjectFilter): FilterOption | null {
    return PROJECT_FILTERS.find((option) => option.id === filter) ?? null;
  },
};

function matches(a: { field: string; direction: SortDirection }, b: { field: string; direction: SortDirection }): boolean {
  return a.field === b.field && a.direction === b.direction;
}
