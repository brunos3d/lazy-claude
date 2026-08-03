import { streamRecords, type JsonlRecord } from '../core/jsonl.js';
import { extractText } from './SessionMetadataService.js';
import type { SessionEntry } from './SessionService.js';

export interface SessionStats {
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  /** Tool name to call count, most used first when read via topTools(). */
  toolBreakdown: Record<string, number>;
  filesTouched: string[];
  filesCreated: string[];
  models: string[];
  gitBranches: string[];
  version?: string;
  inputTokens: number;
  outputTokens: number;
  startedAt?: string;
  endedAt?: string;
  /** Wall-clock milliseconds between the first and last timestamped record. */
  durationMs: number;
  invalidLines: number;
  totalLines: number;
}

export interface TimelineEvent {
  timestamp: string;
  kind: 'session' | 'prompt' | 'tool' | 'file' | 'end';
  label: string;
}

export interface PreviewExchange {
  role: 'user' | 'assistant';
  text: string;
}

export interface Conversation {
  stats: SessionStats;
  timeline: TimelineEvent[];
  /** Opening exchanges, enough to recognize the session. */
  preview: PreviewExchange[];
  /** Human-readable highlights, for example "Edited 12 files". */
  highlights: string[];
}

/** Tools whose input names a file path. */
const FILE_TOOLS = new Set(['Read', 'Edit', 'Write', 'NotebookEdit', 'MultiEdit']);
const CREATE_TOOLS = new Set(['Write']);

const MAX_PREVIEW_EXCHANGES = 6;
const MAX_PREVIEW_CHARS = 300;
const MAX_TIMELINE_EVENTS = 60;

/**
 * Deep analysis of a single session file.
 *
 * This is the only place that understands Claude Code's conversation
 * record shapes. It streams the file once and derives statistics, a
 * timeline, and a short preview together, so opening a session detail
 * never costs more than one pass.
 */
class ConversationServiceImpl {
  async analyze(session: SessionEntry): Promise<Conversation> {
    const stats: SessionStats = {
      userMessages: 0,
      assistantMessages: 0,
      toolCalls: 0,
      toolBreakdown: {},
      filesTouched: [],
      filesCreated: [],
      models: [],
      gitBranches: [],
      inputTokens: 0,
      outputTokens: 0,
      durationMs: 0,
      invalidLines: 0,
      totalLines: 0,
    };

    const touched = new Set<string>();
    const created = new Set<string>();
    const models = new Set<string>();
    const branches = new Set<string>();
    const timeline: TimelineEvent[] = [];
    const preview: PreviewExchange[] = [];

    const pushEvent = (event: TimelineEvent) => {
      if (timeline.length < MAX_TIMELINE_EVENTS) timeline.push(event);
    };

    const { lines, invalid } = await streamRecords(session.file, (record) => {
      collectCommon(record, stats, branches);

      switch (record.type) {
        case 'user':
          if (record.isMeta === true) break;
          handleUser(record, stats, preview, pushEvent);
          break;
        case 'assistant':
          handleAssistant(record, stats, preview, models, touched, created, pushEvent);
          break;
        case 'relocated':
          if (typeof record.timestamp === 'string') {
            pushEvent({
              timestamp: record.timestamp,
              kind: 'session',
              label: `Project relocated to ${String(record.relocatedCwd ?? 'a new path')}`,
            });
          }
          break;
        default:
          break;
      }
    });

    stats.totalLines = lines;
    stats.invalidLines = invalid;
    stats.filesTouched = [...touched];
    stats.filesCreated = [...created];
    stats.models = [...models];
    stats.gitBranches = [...branches];

    if (stats.startedAt && stats.endedAt) {
      const span = Date.parse(stats.endedAt) - Date.parse(stats.startedAt);
      stats.durationMs = Number.isFinite(span) && span > 0 ? span : 0;
      timeline.unshift({
        timestamp: stats.startedAt,
        kind: 'session',
        label: 'Session started',
      });
      timeline.push({ timestamp: stats.endedAt, kind: 'end', label: 'Last activity' });
    }

    return {
      stats,
      timeline,
      preview: preview.slice(0, MAX_PREVIEW_EXCHANGES),
      highlights: buildHighlights(stats),
    };
  }

  /** Tool names ordered by call count. */
  topTools(stats: SessionStats, limit = 6): Array<[string, number]> {
    return Object.entries(stats.toolBreakdown)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);
  }
}

export const ConversationService = new ConversationServiceImpl();

function collectCommon(record: JsonlRecord, stats: SessionStats, branches: Set<string>): void {
  if (typeof record.timestamp === 'string') {
    if (!stats.startedAt) stats.startedAt = record.timestamp;
    stats.endedAt = record.timestamp;
  }
  if (typeof record.gitBranch === 'string' && record.gitBranch) branches.add(record.gitBranch);
  if (!stats.version && typeof record.version === 'string') stats.version = record.version;
}

function handleUser(
  record: JsonlRecord,
  stats: SessionStats,
  preview: PreviewExchange[],
  pushEvent: (event: TimelineEvent) => void,
): void {
  stats.userMessages += 1;
  const text = extractText((record.message as { content?: unknown } | undefined)?.content);
  if (!text) return;
  if (preview.length < MAX_PREVIEW_EXCHANGES) {
    preview.push({ role: 'user', text: truncate(text) });
  }
  if (typeof record.timestamp === 'string' && stats.userMessages <= MAX_TIMELINE_EVENTS) {
    pushEvent({ timestamp: record.timestamp, kind: 'prompt', label: truncate(text, 80) });
  }
}

function handleAssistant(
  record: JsonlRecord,
  stats: SessionStats,
  preview: PreviewExchange[],
  models: Set<string>,
  touched: Set<string>,
  created: Set<string>,
  pushEvent: (event: TimelineEvent) => void,
): void {
  const message = record.message as
    | { model?: string; content?: unknown; usage?: Record<string, number> }
    | undefined;
  if (!message) return;

  stats.assistantMessages += 1;
  if (typeof message.model === 'string') models.add(message.model);

  const usage = message.usage ?? {};
  stats.inputTokens += (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
  stats.outputTokens += usage.output_tokens ?? 0;

  if (!Array.isArray(message.content)) return;
  for (const block of message.content as Array<Record<string, unknown>>) {
    if (block?.type === 'text' && preview.length < MAX_PREVIEW_EXCHANGES) {
      const text = typeof block.text === 'string' ? block.text.trim() : '';
      if (text) preview.push({ role: 'assistant', text: truncate(text) });
    }
    if (block?.type !== 'tool_use') continue;

    const name = typeof block.name === 'string' ? block.name : 'unknown';
    stats.toolCalls += 1;
    stats.toolBreakdown[name] = (stats.toolBreakdown[name] ?? 0) + 1;

    const input = (block.input ?? {}) as Record<string, unknown>;
    const filePath =
      (typeof input.file_path === 'string' && input.file_path) ||
      (typeof input.notebook_path === 'string' && input.notebook_path) ||
      (typeof input.path === 'string' && input.path) ||
      null;
    if (filePath && FILE_TOOLS.has(name)) {
      touched.add(filePath);
      if (CREATE_TOOLS.has(name)) created.add(filePath);
      if (typeof record.timestamp === 'string') {
        pushEvent({
          timestamp: record.timestamp,
          kind: 'file',
          label: `${name} ${shortenFile(filePath)}`,
        });
      }
    } else if (typeof record.timestamp === 'string' && name === 'Bash') {
      const command = typeof input.command === 'string' ? input.command : '';
      pushEvent({
        timestamp: record.timestamp,
        kind: 'tool',
        label: `Bash ${truncate(command, 60)}`,
      });
    }
  }
}

function buildHighlights(stats: SessionStats): string[] {
  const highlights: string[] = [];
  if (stats.filesCreated.length > 0) highlights.push(`Created ${stats.filesCreated.length} file(s)`);
  const modified = stats.filesTouched.length - stats.filesCreated.length;
  if (modified > 0) highlights.push(`Touched ${modified} other file(s)`);
  if (stats.toolCalls > 0) highlights.push(`${stats.toolCalls} tool call(s)`);
  const bash = stats.toolBreakdown.Bash ?? 0;
  if (bash > 0) highlights.push(`${bash} shell command(s)`);
  const agents = stats.toolBreakdown.Agent ?? stats.toolBreakdown.Task ?? 0;
  if (agents > 0) highlights.push(`${agents} subagent run(s)`);
  return highlights;
}

function truncate(text: string, max = MAX_PREVIEW_CHARS): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
}

function shortenFile(filePath: string): string {
  const parts = filePath.split(/[/\\]/);
  return parts.length <= 2 ? filePath : `…/${parts.slice(-2).join('/')}`;
}
