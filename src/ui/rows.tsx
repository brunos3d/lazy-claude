import React from 'react';
import { Box, Text } from 'ink';
import type { Project } from '../services/DiscoveryService.js';
import type { SessionEntry } from '../services/SessionService.js';
import type { SessionMetadata } from '../services/SessionMetadataService.js';
import { formatBytes, formatKb, formatRelativeTime, shortenPath } from '../core/format.js';

/**
 * Row renderers for the two stacked navigation lists.
 *
 * Every line is padded to exactly `width` so a selected row paints a full
 * highlight bar, and truncated to the same width so it can never wrap into
 * the next row. `width` is the usable interior of the panel.
 *
 * Selection is drawn in two strengths. The panel holding the keyboard
 * paints a solid bar; the other panels keep a visible but muted marker, so
 * the current project stays identifiable while the session list is driven.
 */

function fit(text: string, width: number): string {
  if (width <= 0) return '';
  if (text.length > width) return `${text.slice(0, Math.max(0, width - 1))}…`;
  return text.padEnd(width);
}

interface Line {
  text: string;
  color?: string;
  dim?: boolean;
  bold?: boolean;
}

function Row({
  selected,
  focused,
  lines,
}: {
  selected: boolean;
  focused: boolean;
  lines: Line[];
}) {
  const active = selected && focused;
  return (
    <Box flexDirection="column">
      {lines.map((line, i) => (
        <Text
          key={i}
          backgroundColor={active ? 'blue' : undefined}
          color={active ? 'white' : selected ? 'cyan' : line.color}
          dimColor={!selected && line.dim}
          bold={line.bold || selected}
          wrap="truncate"
        >
          {line.text}
        </Text>
      ))}
    </Box>
  );
}

/** Marker column: the caret shows selection even without a highlight bar. */
function marker(selected: boolean, glyph: string): string {
  return selected ? `▶ ${glyph}` : `  ${glyph}`;
}

export function ProjectRow({
  project,
  selected,
  focused,
  home,
  width,
}: {
  project: Project;
  selected: boolean;
  focused: boolean;
  home: string;
  width: number;
}) {
  const glyph = project.orphaned ? '◌' : project.exists ? '●' : '○';
  const glyphColor = project.orphaned ? 'yellow' : project.exists ? 'green' : 'red';
  const label = project.orphaned ? project.encoded : shortenPath(project.path, home);
  const meta =
    `${project.sessions} session${project.sessions === 1 ? '' : 's'} • ${formatKb(project.sessionSizeKb)}` +
    (!project.exists && !project.orphaned ? ' • missing' : '') +
    (project.orphaned ? ' • orphaned' : '');

  return (
    <Row
      selected={selected}
      focused={focused}
      lines={[
        { text: fit(`${marker(selected, glyph)} ${label}`, width), color: glyphColor, bold: true },
        { text: fit(`      ${meta}`, width), dim: true },
      ]}
    />
  );
}

export function AllSessionsRow({
  selected,
  focused,
  count,
  width,
}: {
  selected: boolean;
  focused: boolean;
  count: number;
  width: number;
}) {
  return (
    <Row
      selected={selected}
      focused={focused}
      lines={[
        { text: fit(`${marker(selected, '▣')} All sessions`, width), bold: true },
        { text: fit(`      ${count} sessions across every project`, width), dim: true },
      ]}
    />
  );
}

/**
 * Two-line session row, modelled on Claude Code's own resume picker: the
 * title carries recognition, the second line carries the facts. The id is
 * last on that line because it is the weakest identifier.
 */
export function SessionRow({
  session,
  metadata,
  selected,
  focused,
  showProject,
  home,
  width,
}: {
  session: SessionEntry;
  metadata: SessionMetadata | undefined;
  selected: boolean;
  focused: boolean;
  showProject: boolean;
  home: string;
  width: number;
}) {
  const title = metadata?.title ?? session.id;
  const inferred = metadata !== undefined && metadata.titleSource !== 'ai-title';

  const facts: string[] = [formatRelativeTime(session.modifiedAt), formatBytes(session.sizeBytes)];
  if (metadata?.gitBranch) facts.push(metadata.gitBranch);
  if (session.archived) facts.push('archived');
  if (metadata?.relocatedCwd) facts.push('relocated');
  if (showProject && metadata?.cwd) facts.push(shortenPath(metadata.cwd, home));
  facts.push(session.id.slice(0, 8));

  return (
    <Row
      selected={selected}
      focused={focused}
      lines={[
        {
          text: fit(`${selected ? '▶' : ' '} ${title}`, width),
          color: inferred ? 'gray' : 'white',
          bold: true,
        },
        { text: fit(`   ${facts.join(' • ')}`, width), dim: true },
      ]}
    />
  );
}
