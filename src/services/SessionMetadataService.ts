import fs from 'node:fs/promises';
import { parseChunk, readHead, readTail, type JsonlRecord } from '../core/jsonl.js';
import { MetadataCache } from './MetadataCache.js';
import type { SessionEntry } from './SessionService.js';

/**
 * Where a session's display title came from. Useful in the UI to show a
 * real title differently from a guessed one.
 */
export type TitleSource = 'ai-title' | 'last-prompt' | 'first-message' | 'command' | 'empty' | 'id';

export interface SessionMetadata {
  /** Human-readable label, the same title Claude Code's resume picker shows. */
  title: string;
  titleSource: TitleSource;
  /** Working directory recorded in the session. */
  cwd?: string;
  /** Git branch recorded on the session's records. */
  gitBranch?: string;
  /** Claude Code version that wrote the session. */
  version?: string;
  /** Set when Claude Code recorded the session as relocated to a new cwd. */
  relocatedCwd?: string;
  /** ISO timestamp of the first record carrying one. */
  startedAt?: string;
  /** ISO timestamp of the last record carrying one. */
  endedAt?: string;
}

/**
 * Fast per-session metadata.
 *
 * Claude Code writes the AI-generated title (`ai-title`) near the END of a
 * session file and the opening context near the start, so this reads a
 * chunk from each end rather than the whole file. Results are cached on
 * disk and invalidated by size/mtime, which makes repeat launches instant.
 */
/** Bump when the parsing rules below change, to invalidate stale caches. */
const PARSER_VERSION = 2;

class SessionMetadataServiceImpl {
  private cache = new MetadataCache<SessionMetadata>('session-metadata', PARSER_VERSION);

  /** Metadata for one session, from cache when the file is unchanged. */
  async get(session: SessionEntry): Promise<SessionMetadata> {
    await this.cache.load();
    const key = session.file;
    const cached = this.cache.get(key, session.sizeBytes, session.modifiedAt.getTime());
    if (cached) return cached;

    const metadata = await this.parse(session);
    this.cache.set(key, session.sizeBytes, session.modifiedAt.getTime(), metadata);
    return metadata;
  }

  /**
   * Metadata for many sessions. Uncached files are parsed with bounded
   * concurrency so a large project does not open hundreds of files at once.
   *
   * `onProgress` receives the live result map, not a copy, so a caller
   * showing progress can render partial titles without paying an O(n) copy
   * per batch. The map is complete once the returned promise resolves.
   */
  async getMany(
    sessions: SessionEntry[],
    onProgress?: (progress: {
      done: number;
      total: number;
      metadata: Map<string, SessionMetadata>;
    }) => void,
  ): Promise<Map<string, SessionMetadata>> {
    await this.cache.load();
    const result = new Map<string, SessionMetadata>();
    const pending: SessionEntry[] = [];

    for (const session of sessions) {
      const cached = this.cache.get(session.file, session.sizeBytes, session.modifiedAt.getTime());
      if (cached) result.set(session.file, cached);
      else pending.push(session);
    }

    onProgress?.({ done: result.size, total: sessions.length, metadata: result });

    const CONCURRENCY = 12;
    for (let i = 0; i < pending.length; i += CONCURRENCY) {
      const batch = pending.slice(i, i + CONCURRENCY);
      const parsed = await Promise.all(
        batch.map(async (session) => [session, await this.parse(session)] as const),
      );
      for (const [session, metadata] of parsed) {
        this.cache.set(session.file, session.sizeBytes, session.modifiedAt.getTime(), metadata);
        result.set(session.file, metadata);
      }
      onProgress?.({ done: result.size, total: sessions.length, metadata: result });
    }

    await this.cache.save();
    return result;
  }

  /** Drop cache entries for sessions that no longer exist. */
  async prune(liveFiles: Set<string>): Promise<void> {
    await this.cache.load();
    this.cache.prune(liveFiles);
    await this.cache.save();
  }

  async clearCache(): Promise<void> {
    await this.cache.clear();
  }

  private async parse(session: SessionEntry): Promise<SessionMetadata> {
    const metadata: SessionMetadata = { title: session.id, titleSource: 'id' };

    // Tail first: the AI title and the final timestamp live at the end.
    let tailRecords: JsonlRecord[] = [];
    try {
      tailRecords = parseChunk(await readTail(session.file));
    } catch {
      return metadata;
    }
    for (let i = tailRecords.length - 1; i >= 0; i--) {
      const record = tailRecords[i];
      if (!metadata.endedAt && typeof record.timestamp === 'string') {
        metadata.endedAt = record.timestamp;
      }
      if (record.type === 'ai-title' && typeof record.aiTitle === 'string' && record.aiTitle.trim()) {
        metadata.title = record.aiTitle.trim();
        metadata.titleSource = 'ai-title';
        break;
      }
    }

    // Head: opening context and the fallback title sources.
    let headRecords: JsonlRecord[] = [];
    try {
      headRecords = parseChunk(await readHead(session.file));
    } catch {
      return metadata;
    }

    let lastPrompt: string | undefined;
    let firstMessage: string | undefined;
    let firstCommand: string | undefined;
    let sawAnyMessage = false;
    for (const record of headRecords) {
      if (!metadata.cwd && typeof record.cwd === 'string') metadata.cwd = record.cwd;
      if (!metadata.gitBranch && typeof record.gitBranch === 'string' && record.gitBranch) {
        metadata.gitBranch = record.gitBranch;
      }
      if (!metadata.version && typeof record.version === 'string') metadata.version = record.version;
      if (!metadata.startedAt && typeof record.timestamp === 'string') {
        metadata.startedAt = record.timestamp;
      }
      if (record.type === 'relocated' && typeof record.relocatedCwd === 'string') {
        metadata.relocatedCwd = record.relocatedCwd;
      }
      if (!lastPrompt && record.type === 'last-prompt' && typeof record.lastPrompt === 'string') {
        const text = record.lastPrompt.trim();
        if (text && !isMarkup(text)) lastPrompt = text;
      }
      if (record.type === 'user' && record.isMeta !== true) {
        const text = extractText((record.message as { content?: unknown } | undefined)?.content);
        if (text) {
          sawAnyMessage = true;
          const command = slashCommand(text);
          if (command) {
            if (!firstCommand) firstCommand = command;
          } else if (!isMarkup(text) && !firstMessage) {
            firstMessage = text;
          }
        }
      }
    }

    if (metadata.titleSource === 'id') {
      if (lastPrompt) {
        metadata.title = toTitle(lastPrompt);
        metadata.titleSource = 'last-prompt';
      } else if (firstMessage) {
        metadata.title = toTitle(firstMessage);
        metadata.titleSource = 'first-message';
      } else if (firstCommand) {
        metadata.title = firstCommand;
        metadata.titleSource = 'command';
      } else if (!sawAnyMessage) {
        // Only hooks, system records, or an aborted start: there is no
        // conversation to name, so say so instead of showing a bare UUID.
        metadata.title = '(empty session)';
        metadata.titleSource = 'empty';
      }
    }

    return metadata;
  }
}

export const SessionMetadataService = new SessionMetadataServiceImpl();

const MAX_TITLE = 72;

/**
 * Claude Code stores slash commands, caveats, and injected context as user
 * messages wrapped in pseudo-XML. None of it names a conversation.
 */
const MARKUP_PREFIXES = [
  '<command-name>',
  '<command-message>',
  '<command-args>',
  '<local-command',
  '<system-reminder>',
  '<user-prompt-submit-hook>',
  'Caveat:',
];

function isMarkup(text: string): boolean {
  const trimmed = text.trimStart();
  return MARKUP_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

/** Recover the command name from a slash-command record, e.g. "/clear". */
function slashCommand(text: string): string | null {
  const match = /^\s*<command-name>\s*([^<]+?)\s*<\/command-name>/.exec(text);
  if (match) return match[1].trim();
  const bare = /^\s*(\/[a-z][\w:-]*)\s*$/i.exec(text);
  return bare ? bare[1] : null;
}

/** Collapse a prompt into a single-line label. */
function toTitle(text: string): string {
  const firstLine =
    text
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !line.startsWith('<') && !line.startsWith('#')) ??
    text.trim();
  const collapsed = firstLine.replace(/\s+/g, ' ').trim();
  return collapsed.length > MAX_TITLE ? `${collapsed.slice(0, MAX_TITLE - 1)}…` : collapsed;
}

/** Pull display text out of a message content field (string or block list). */
export function extractText(content: unknown): string | undefined {
  if (typeof content === 'string') return content.trim() || undefined;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block && typeof block === 'object' && (block as { type?: string }).type === 'text') {
        const text = (block as { text?: string }).text;
        if (typeof text === 'string' && text.trim()) return text.trim();
      }
    }
  }
  return undefined;
}
