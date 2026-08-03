import React from 'react';
import { Box, Text } from 'ink';
import type { Project } from '../services/DiscoveryService.js';
import type { SessionEntry } from '../services/SessionService.js';
import type { SessionMetadata } from '../services/SessionMetadataService.js';
import { formatBytes, formatKb, formatRelativeTime, shortenPath } from '../core/format.js';

/**
 * Row renderers for the contextual list.
 *
 * Every line is padded to exactly `width` so a selected row paints a full
 * highlight bar, and truncated to the same width so it can never wrap into
 * the next row. `width` is the usable interior of the panel.
 */

function fit(text: string, width: number): string {
  if (width <= 0) return '';
  if (text.length > width) return `${text.slice(0, Math.max(0, width - 1))}…`;
  return text.padEnd(width);
}

function Row({
  selected,
  lines,
}: {
  selected: boolean;
  lines: Array<{ text: string; color?: string; dim?: boolean; bold?: boolean }>;
}) {
  return (
    <Box flexDirection="column">
      {lines.map((line, i) => (
        <Text
          key={i}
          backgroundColor={selected ? 'blue' : undefined}
          color={selected ? 'white' : line.color}
          dimColor={!selected && line.dim}
          bold={line.bold}
          wrap="truncate"
        >
          {line.text}
        </Text>
      ))}
    </Box>
  );
}

export function ProjectRow({
  project,
  selected,
  home,
  width,
}: {
  project: Project;
  selected: boolean;
  home: string;
  width: number;
}) {
  const marker = project.orphaned ? '◌' : project.exists ? '●' : '○';
  const markerColor = project.orphaned ? 'yellow' : project.exists ? 'green' : 'red';
  const label = project.orphaned ? project.encoded : shortenPath(project.path, home);
  const meta =
    `${project.sessions} session${project.sessions === 1 ? '' : 's'} · ${formatKb(project.sessionSizeKb)}` +
    (!project.exists && !project.orphaned ? ' · missing' : '') +
    (project.orphaned ? ' · orphaned' : '');

  return (
    <Row
      selected={selected}
      lines={[
        { text: fit(`${marker} ${label}`, width), color: markerColor, bold: selected },
        { text: fit(`  ${meta}`, width), dim: true },
      ]}
    />
  );
}

export function AllSessionsRow({
  selected,
  count,
  width,
}: {
  selected: boolean;
  count: number;
  width: number;
}) {
  return (
    <Row
      selected={selected}
      lines={[
        { text: fit('▣ All sessions', width), bold: true },
        { text: fit(`  ${count} sessions across every project`, width), dim: true },
      ]}
    />
  );
}

/**
 * Two-line session row, modelled on Claude Code's own resume picker: the
 * title carries recognition, the second line carries the facts.
 */
export function SessionRow({
  session,
  metadata,
  selected,
  showProject,
  home,
  width,
}: {
  session: SessionEntry;
  metadata: SessionMetadata | undefined;
  selected: boolean;
  showProject: boolean;
  home: string;
  width: number;
}) {
  const title = metadata?.title ?? session.id;
  const inferred = metadata !== undefined && metadata.titleSource !== 'ai-title';

  const facts: string[] = [
    session.id.slice(0, 8),
    formatRelativeTime(session.modifiedAt),
    formatBytes(session.sizeBytes),
  ];
  if (metadata?.gitBranch) facts.push(metadata.gitBranch);
  if (session.archived) facts.push('archived');
  if (metadata?.relocatedCwd) facts.push('relocated');
  if (showProject && metadata?.cwd) facts.push(shortenPath(metadata.cwd, home));

  return (
    <Row
      selected={selected}
      lines={[
        {
          text: fit(`${selected ? '❯' : ' '} ${title}`, width),
          color: inferred ? 'gray' : 'white',
          bold: selected,
        },
        { text: fit(`  ${facts.join(' · ')}`, width), dim: true },
      ]}
    />
  );
}
