import os from 'node:os';
import { formatBytes, formatCount, shortenPath } from '../core/format.js';
import { DiscoveryService, type Project } from './DiscoveryService.js';
import { SessionMetadataService, type SessionMetadata } from './SessionMetadataService.js';
import {
  listAllArchivedSessions,
  listAllSessions,
  type SessionEntry,
} from './SessionService.js';

/**
 * Workspace-wide numbers.
 *
 * Sizes are computed from the session list rather than from
 * `Project.sessionSizeKb`, because that field counts only the live folder
 * and the point of a storage report is to include what was archived.
 *
 * `compute` is pure so the TUI can render it straight from the in-memory
 * search index without touching disk, and the CLI can gather the same
 * inputs itself. There is one implementation of the arithmetic and one of
 * the formatting.
 */

export interface SessionRank {
  id: string;
  file: string;
  encoded: string;
  bytes: number;
  archived: boolean;
  /** Filled in when metadata is available, otherwise the row shows the id. */
  title?: string;
}

export interface ProjectRank {
  label: string;
  encoded: string;
  sessions: number;
  bytes: number;
}

export interface WorkspaceStats {
  projects: { total: number; missing: number; orphaned: number; empty: number };
  sessions: { live: number; archived: number; total: number };
  bytes: { live: number; archived: number; total: number; average: number };
  largestSessions: SessionRank[];
  largestProjects: ProjectRank[];
  oldest: Date | null;
  newest: Date | null;
}

export interface StatsInput {
  projects: Project[];
  /** Live and archived together. */
  sessions: SessionEntry[];
  metadata?: Map<string, SessionMetadata>;
  home?: string;
}

/** How many rows each "largest" table shows. */
const TOP = 5;

function projectLabel(project: Project, home: string): string {
  return project.orphaned ? project.encoded : shortenPath(project.path, home);
}

export const StatsService = {
  compute(input: StatsInput): WorkspaceStats {
    const home = input.home ?? os.homedir();
    const { projects, sessions, metadata } = input;

    const live = sessions.filter((session) => !session.archived);
    const archived = sessions.filter((session) => session.archived);
    const sum = (list: SessionEntry[]) => list.reduce((total, s) => total + s.sizeBytes, 0);
    const liveBytes = sum(live);
    const archivedBytes = sum(archived);
    const totalBytes = liveBytes + archivedBytes;

    const byEncoded = new Map<string, { sessions: number; bytes: number }>();
    for (const session of sessions) {
      const entry = byEncoded.get(session.encoded) ?? { sessions: 0, bytes: 0 };
      entry.sessions += 1;
      entry.bytes += session.sizeBytes;
      byEncoded.set(session.encoded, entry);
    }

    const largestProjects: ProjectRank[] = projects
      .map((project) => {
        const totals = byEncoded.get(project.encoded) ?? { sessions: 0, bytes: 0 };
        return {
          label: projectLabel(project, home),
          encoded: project.encoded,
          sessions: totals.sessions,
          bytes: totals.bytes,
        };
      })
      .filter((entry) => entry.bytes > 0)
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, TOP);

    const largestSessions: SessionRank[] = [...sessions]
      .sort((a, b) => b.sizeBytes - a.sizeBytes)
      .slice(0, TOP)
      .map((session) => ({
        id: session.id,
        file: session.file,
        encoded: session.encoded,
        bytes: session.sizeBytes,
        archived: session.archived,
        title: metadata?.get(session.file)?.title,
      }));

    const times = sessions.map((session) => session.modifiedAt.getTime());

    return {
      projects: {
        total: projects.length,
        missing: projects.filter((p) => !p.exists && !p.orphaned).length,
        orphaned: projects.filter((p) => p.orphaned).length,
        empty: projects.filter((p) => p.sessions === 0).length,
      },
      sessions: { live: live.length, archived: archived.length, total: sessions.length },
      bytes: {
        live: liveBytes,
        archived: archivedBytes,
        total: totalBytes,
        average: sessions.length > 0 ? Math.round(totalBytes / sessions.length) : 0,
      },
      largestSessions,
      largestProjects,
      oldest: times.length > 0 ? new Date(Math.min(...times)) : null,
      newest: times.length > 0 ? new Date(Math.max(...times)) : null,
    };
  },

  /**
   * Gather the inputs from disk, for the CLI.
   *
   * Titles are read only for the handful of sessions that made the largest
   * table, so this stays a directory walk rather than a full metadata pass
   * over a workspace that can hold thousands of files.
   */
  async collect(home = os.homedir()): Promise<WorkspaceStats> {
    const [projects, live, archived] = await Promise.all([
      DiscoveryService.discoverProjects(),
      listAllSessions(),
      listAllArchivedSessions(),
    ]);

    const stats = StatsService.compute({ projects, sessions: [...live, ...archived], home });

    const ranked = stats.largestSessions;
    if (ranked.length > 0) {
      const files = new Map([...live, ...archived].map((session) => [session.file, session]));
      const metadata = await SessionMetadataService.getMany(
        ranked.map((entry) => files.get(entry.file)).filter((entry): entry is SessionEntry => !!entry),
      );
      for (const entry of ranked) entry.title = metadata.get(entry.file)?.title;
    }

    return stats;
  },

  format(stats: WorkspaceStats): string {
    const lines: string[] = [];
    const { projects, sessions, bytes } = stats;

    lines.push('Projects');
    lines.push(`  Total            ${formatCount(projects.total)}`);
    lines.push(`  Missing on disk  ${formatCount(projects.missing)}`);
    lines.push(`  Orphaned         ${formatCount(projects.orphaned)}`);
    lines.push(`  Empty            ${formatCount(projects.empty)}`);
    lines.push('');

    lines.push('Sessions');
    lines.push(`  Live             ${formatCount(sessions.live)}`);
    lines.push(`  Archived         ${formatCount(sessions.archived)}`);
    lines.push(`  Total            ${formatCount(sessions.total)}`);
    lines.push('');

    lines.push('Storage');
    lines.push(`  Live             ${formatBytes(bytes.live)}`);
    lines.push(`  Archived         ${formatBytes(bytes.archived)}`);
    lines.push(`  Total            ${formatBytes(bytes.total)}`);
    lines.push(`  Average session  ${formatBytes(bytes.average)}`);
    if (stats.newest) lines.push(`  Newest session   ${stats.newest.toLocaleString()}`);
    if (stats.oldest) lines.push(`  Oldest session   ${stats.oldest.toLocaleString()}`);

    if (stats.largestProjects.length > 0) {
      lines.push('');
      lines.push('Largest projects');
      for (const entry of stats.largestProjects) {
        const count = `${formatCount(entry.sessions).padStart(4)} ${entry.sessions === 1 ? 'session ' : 'sessions'}`;
        lines.push(`  ${formatBytes(entry.bytes).padStart(9)}  ${count}  ${entry.label}`);
      }
    }

    if (stats.largestSessions.length > 0) {
      lines.push('');
      lines.push('Largest sessions');
      for (const entry of stats.largestSessions) {
        const label = entry.title ?? entry.id;
        const tag = entry.archived ? ' (archived)' : '';
        lines.push(`  ${formatBytes(entry.bytes).padStart(9)}  ${label}${tag}`);
      }
    }

    if (sessions.total === 0) {
      lines.push('');
      lines.push('No sessions found.');
    }

    return lines.join('\n');
  },
};
