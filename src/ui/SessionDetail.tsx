import React from 'react';
import { Box, Text } from 'ink';
import type { SessionEntry } from '../services/SessionService.js';
import type { SessionMetadata } from '../services/SessionMetadataService.js';
import type { Conversation } from '../services/ConversationService.js';
import { ConversationService } from '../services/ConversationService.js';
import {
  formatBytes,
  formatClock,
  formatCount,
  formatDuration,
  formatRelativeTime,
  formatTokens,
  shortenPath,
} from '../core/format.js';

export type DetailTab = 'overview' | 'conversation' | 'timeline' | 'files';

export const DETAIL_TABS: DetailTab[] = ['overview', 'conversation', 'timeline', 'files'];

interface SessionDetailProps {
  session: SessionEntry;
  metadata: SessionMetadata | undefined;
  conversation: Conversation | null;
  loading: boolean;
  tab: DetailTab;
  home: string;
  height: number;
  scroll: number;
  /**
   * Current project path for this session. Authoritative over the cwd
   * recorded inside the file, which stays at the old location after a move.
   */
  projectPath?: string;
}

function Field({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Text wrap="truncate">
      <Text dimColor>{label.padEnd(11)}</Text>
      <Text color={color}>{value}</Text>
    </Text>
  );
}

/**
 * The wide panel: everything known about one session, split into tabs so
 * dense data stays readable. Parsing lives in the services; this only
 * arranges what they return.
 */
export function SessionDetail({
  session,
  metadata,
  conversation,
  loading,
  tab,
  home,
  height,
  scroll,
  projectPath,
}: SessionDetailProps) {
  const lines = renderTab(tab, session, metadata, conversation, loading, home, projectPath);
  const inner = Math.max(1, height);
  const maxScroll = Math.max(0, lines.length - inner);
  const offset = Math.min(scroll, maxScroll);
  const visible = lines.slice(offset, offset + inner);

  return (
    <Box flexDirection="column" paddingX={1}>
      {visible.map((line, i) => (
        <Box key={offset + i}>{line}</Box>
      ))}
      {maxScroll > 0 ? (
        <Text dimColor>
          {'  '}… {offset + visible.length}/{lines.length} lines (J/K scroll)
        </Text>
      ) : null}
    </Box>
  );
}

function renderTab(
  tab: DetailTab,
  session: SessionEntry,
  metadata: SessionMetadata | undefined,
  conversation: Conversation | null,
  loading: boolean,
  home: string,
  projectPath?: string,
): React.ReactNode[] {
  switch (tab) {
    case 'overview':
      return overviewLines(session, metadata, conversation, loading, home, projectPath);
    case 'conversation':
      return conversationLines(conversation, loading);
    case 'timeline':
      return timelineLines(conversation, loading);
    case 'files':
      return fileLines(conversation, loading, home);
  }
}

function overviewLines(
  session: SessionEntry,
  metadata: SessionMetadata | undefined,
  conversation: Conversation | null,
  loading: boolean,
  home: string,
  projectPath?: string,
): React.ReactNode[] {
  const lines: React.ReactNode[] = [];
  const title = metadata?.title ?? session.id;

  lines.push(
    <Text bold color="cyan" wrap="truncate">
      {title}
    </Text>,
  );
  if (metadata && metadata.titleSource !== 'ai-title' && metadata.titleSource !== 'id') {
    lines.push(<Text dimColor>(title inferred from the opening prompt)</Text>);
  }
  lines.push(<Text> </Text>);

  lines.push(<Field label="Session" value={session.id} />);
  const currentPath = projectPath ?? metadata?.cwd;
  lines.push(
    <Field label="Project" value={currentPath ? shortenPath(currentPath, home) : session.encoded} />,
  );
  // The cwd baked into the file stays at the old location after a move.
  if (metadata?.cwd && projectPath && metadata.cwd !== projectPath) {
    lines.push(
      <Field label="Recorded" value={shortenPath(metadata.cwd, home)} color="yellow" />,
    );
  }
  if (metadata?.relocatedCwd) {
    lines.push(
      <Field label="Relocated" value={shortenPath(metadata.relocatedCwd, home)} color="yellow" />,
    );
  }
  if (metadata?.gitBranch) lines.push(<Field label="Branch" value={metadata.gitBranch} />);
  lines.push(
    <Field
      label="Modified"
      value={`${formatRelativeTime(session.modifiedAt)} (${session.modifiedAt.toLocaleString()})`}
    />,
  );
  if (metadata?.startedAt) {
    const started = new Date(metadata.startedAt);
    if (!Number.isNaN(started.getTime())) {
      lines.push(<Field label="Started" value={started.toLocaleString()} />);
    }
  }
  lines.push(
    <Field
      label="Size"
      value={`${formatBytes(session.sizeBytes)}${session.archived ? '   [archived]' : ''}`}
      color={session.archived ? 'yellow' : undefined}
    />,
  );
  if (metadata?.version) lines.push(<Field label="Version" value={`Claude Code ${metadata.version}`} />);

  lines.push(<Text> </Text>);

  if (loading) {
    lines.push(<Text dimColor>Analyzing conversation…</Text>);
    return lines;
  }
  if (!conversation) {
    lines.push(<Text dimColor>Press enter to analyze this session.</Text>);
    return lines;
  }

  const { stats } = conversation;
  lines.push(<Text bold>Statistics</Text>);
  lines.push(
    <Field
      label="Messages"
      value={`${formatCount(stats.userMessages)} user / ${formatCount(stats.assistantMessages)} assistant`}
    />,
  );
  lines.push(<Field label="Tool calls" value={formatCount(stats.toolCalls)} />);
  lines.push(
    <Field
      label="Files"
      value={`${stats.filesTouched.length} touched, ${stats.filesCreated.length} created`}
    />,
  );
  if (stats.inputTokens > 0 || stats.outputTokens > 0) {
    lines.push(
      <Field
        label="Tokens"
        value={`${formatTokens(stats.inputTokens)} in / ${formatTokens(stats.outputTokens)} out`}
      />,
    );
  }
  if (stats.durationMs > 0) {
    lines.push(<Field label="Duration" value={formatDuration(stats.durationMs)} />);
  }
  if (stats.models.length > 0) lines.push(<Field label="Model" value={stats.models.join(', ')} />);
  if (stats.invalidLines > 0) {
    lines.push(
      <Field
        label="Integrity"
        value={`${stats.invalidLines} invalid of ${stats.totalLines} lines`}
        color="red"
      />,
    );
  }

  const tools = ConversationService.topTools(conversation.stats);
  if (tools.length > 0) {
    lines.push(<Text> </Text>);
    lines.push(<Text bold>Top tools</Text>);
    for (const [name, count] of tools) {
      lines.push(<Field label={name} value={`${count}`} />);
    }
  }

  if (conversation.highlights.length > 0) {
    lines.push(<Text> </Text>);
    lines.push(<Text bold>Highlights</Text>);
    for (const highlight of conversation.highlights) {
      lines.push(<Text wrap="truncate">{`  • ${highlight}`}</Text>);
    }
  }

  return lines;
}

function conversationLines(conversation: Conversation | null, loading: boolean): React.ReactNode[] {
  if (loading) return [<Text dimColor key="l">Analyzing conversation…</Text>];
  if (!conversation) return [<Text dimColor key="n">No conversation data.</Text>];
  if (conversation.preview.length === 0) {
    return [<Text dimColor key="e">This session has no readable messages.</Text>];
  }

  const lines: React.ReactNode[] = [];
  for (const exchange of conversation.preview) {
    lines.push(
      <Text bold color={exchange.role === 'user' ? 'green' : 'magenta'}>
        {exchange.role === 'user' ? 'User' : 'Assistant'}
      </Text>,
    );
    for (const chunk of wrapText(exchange.text, 96)) {
      lines.push(<Text wrap="truncate">{`  ${chunk}`}</Text>);
    }
    lines.push(<Text> </Text>);
  }
  lines.push(<Text dimColor>Preview only. Resume the session in Claude Code for the full thread.</Text>);
  return lines;
}

function timelineLines(conversation: Conversation | null, loading: boolean): React.ReactNode[] {
  if (loading) return [<Text dimColor key="l">Building timeline…</Text>];
  if (!conversation || conversation.timeline.length === 0) {
    return [<Text dimColor key="n">No timestamped activity found.</Text>];
  }
  const colors: Record<string, string> = {
    session: 'cyan',
    prompt: 'green',
    tool: 'yellow',
    file: 'blue',
    end: 'gray',
  };
  return conversation.timeline.map((event, i) => (
    <Text key={i} wrap="truncate">
      <Text dimColor>{formatClock(event.timestamp).padEnd(7)}</Text>
      <Text color={colors[event.kind]}>{event.kind === 'prompt' ? '❯ ' : '• '}</Text>
      {event.label}
    </Text>
  ));
}

function fileLines(
  conversation: Conversation | null,
  loading: boolean,
  home: string,
): React.ReactNode[] {
  if (loading) return [<Text dimColor key="l">Scanning file activity…</Text>];
  if (!conversation) return [<Text dimColor key="n">No file data.</Text>];
  const { filesTouched, filesCreated } = conversation.stats;
  if (filesTouched.length === 0) {
    return [<Text dimColor key="e">No files were read or written in this session.</Text>];
  }
  const created = new Set(filesCreated);
  const lines: React.ReactNode[] = [
    <Text key="h" bold>
      {filesTouched.length} file(s), {filesCreated.length} created
    </Text>,
    <Text key="s"> </Text>,
  ];
  for (const file of filesTouched) {
    lines.push(
      <Text key={file} wrap="truncate">
        <Text color={created.has(file) ? 'green' : 'blue'}>{created.has(file) ? '+ ' : '~ '}</Text>
        {shortenPath(file, home)}
      </Text>,
    );
  }
  return lines;
}

/** Soft-wrap a paragraph to a column width. */
function wrapText(text: string, width: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (current.length + word.length + 1 > width) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 8);
}
