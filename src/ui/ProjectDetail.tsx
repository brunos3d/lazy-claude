import React from 'react';
import { Box, Text } from 'ink';
import type { Project } from '../services/DiscoveryService.js';
import type { SessionEntry } from '../services/SessionService.js';
import type { SessionMetadata } from '../services/SessionMetadataService.js';
import { formatKb, formatRelativeTime, shortenPath } from '../core/format.js';

/**
 * Right-hand panel while browsing projects: a summary of the highlighted
 * project plus a peek at its most recent sessions, so the project list is
 * useful before drilling in.
 */
export function ProjectDetail({
  project,
  sessions,
  metadata,
  loading,
  projects,
  home,
  height,
}: {
  project: Project | null;
  sessions: SessionEntry[];
  metadata: Map<string, SessionMetadata>;
  loading: boolean;
  projects: Project[] | null;
  home: string;
  height: number;
}) {
  if (!project) {
    const all = projects ?? [];
    const totalSessions = all.reduce((sum, p) => sum + p.sessions, 0);
    const broken = all.filter((p) => !p.exists && !p.orphaned).length;
    const orphans = all.filter((p) => p.orphaned).length;
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text bold color="cyan">
          All Claude Code projects on this machine
        </Text>
        <Box marginTop={1} flexDirection="column">
          <Row label="Projects" value={String(all.length)} />
          <Row label="Sessions" value={String(totalSessions)} />
          <Row
            label="Health"
            value={`${broken} missing path(s), ${orphans} orphaned folder(s)`}
            color={broken + orphans > 0 ? 'yellow' : 'green'}
          />
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Press enter to browse every session, or pick a project on the left.</Text>
        </Box>
        {broken > 0 ? (
          <Box marginTop={1}>
            <Text color="yellow">Press F to relink projects whose directory moved.</Text>
          </Box>
        ) : null}
      </Box>
    );
  }

  const recent = sessions.slice(0, Math.max(3, Math.floor((height - 12) / 2)));

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyan" wrap="truncate">
        {project.orphaned ? project.encoded : shortenPath(project.path, home)}
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Row
          label="Status"
          value={
            project.orphaned
              ? 'orphaned session folder, no project path resolved'
              : project.exists
                ? 'healthy'
                : 'project directory is missing'
          }
          color={project.orphaned ? 'yellow' : project.exists ? 'green' : 'red'}
        />
        <Row label="Folder" value={project.encoded} />
        <Row label="Sessions" value={`${project.sessions} (${formatKb(project.sessionSizeKb)})`} />
        {project.lastActivity > 0 ? (
          <Row label="Activity" value={formatRelativeTime(new Date(project.lastActivity * 1000))} />
        ) : null}
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text bold>Recent sessions</Text>
        {loading ? (
          <Text dimColor>Loading…</Text>
        ) : recent.length === 0 ? (
          <Text dimColor>No sessions recorded for this project.</Text>
        ) : (
          recent.map((session) => (
            <Box key={session.file} flexDirection="column">
              <Text wrap="truncate">
                <Text color="cyan">• </Text>
                {metadata.get(session.file)?.title ?? session.id}
              </Text>
              <Text dimColor wrap="truncate">
                {'    '}
                {session.id.slice(0, 8)} · {formatRelativeTime(session.modifiedAt)}
              </Text>
            </Box>
          ))
        )}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>enter to browse, x for actions</Text>
      </Box>
    </Box>
  );
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Text wrap="truncate">
      <Text dimColor>{label.padEnd(10)}</Text>
      <Text color={color}>{value}</Text>
    </Text>
  );
}
