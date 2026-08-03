import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { createReadStream } from 'node:fs';
import { archiveDir, projectsDir } from './paths.js';

export interface SessionEntry {
  /** Session id, the JSONL filename without extension. */
  id: string;
  /** Encoded project folder this session belongs to. */
  encoded: string;
  /** Absolute path of the JSONL file. */
  file: string;
  sizeBytes: number;
  modifiedAt: Date;
  archived: boolean;
}

export interface SessionDetail {
  /** Summary line Claude Code wrote for the session, if any. */
  summary?: string;
  /** Working directory recorded in the session. */
  cwd?: string;
  /** First user message, truncated. */
  firstMessage?: string;
  /** Timestamp of the first record. */
  startedAt?: string;
  /** Number of JSONL records scanned (capped). */
  scannedRecords: number;
}

async function listJsonlFiles(dir: string, encoded: string, archived: boolean): Promise<SessionEntry[]> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }

  const entries: SessionEntry[] = [];
  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue;
    const file = path.join(dir, name);
    try {
      const stat = await fs.stat(file);
      if (!stat.isFile()) continue;
      entries.push({
        id: name.slice(0, -'.jsonl'.length),
        encoded,
        file,
        sizeBytes: stat.size,
        modifiedAt: stat.mtime,
        archived,
      });
    } catch {
      // File vanished between readdir and stat; skip it.
    }
  }
  entries.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
  return entries;
}

/** Live sessions for one encoded project folder. */
export function listSessions(encoded: string): Promise<SessionEntry[]> {
  return listJsonlFiles(path.join(projectsDir(), encoded), encoded, false);
}

/** Archived sessions for one encoded project folder. */
export function listArchivedSessions(encoded: string): Promise<SessionEntry[]> {
  return listJsonlFiles(path.join(archiveDir(), encoded), encoded, true);
}

/** All live sessions across every project folder, newest first. */
export async function listAllSessions(): Promise<SessionEntry[]> {
  let folders: string[];
  try {
    folders = await fs.readdir(projectsDir());
  } catch {
    return [];
  }
  const nested = await Promise.all(folders.map((encoded) => listSessions(encoded)));
  const all = nested.flat();
  all.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
  return all;
}

/** All archived sessions across every project folder, newest first. */
export async function listAllArchivedSessions(): Promise<SessionEntry[]> {
  let folders: string[];
  try {
    folders = await fs.readdir(archiveDir());
  } catch {
    return [];
  }
  const nested = await Promise.all(folders.map((encoded) => listArchivedSessions(encoded)));
  const all = nested.flat();
  all.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
  return all;
}

/**
 * Move a session file into the archive tree. The archive lives outside
 * the projects directory so Claude Code no longer sees the session.
 */
export async function archiveSession(session: SessionEntry): Promise<void> {
  const destDir = path.join(archiveDir(), session.encoded);
  await fs.mkdir(destDir, { recursive: true });
  await moveFile(session.file, path.join(destDir, `${session.id}.jsonl`));
}

/** Move an archived session back into the projects directory. */
export async function restoreSession(session: SessionEntry): Promise<void> {
  const destDir = path.join(projectsDir(), session.encoded);
  await fs.mkdir(destDir, { recursive: true });
  await moveFile(session.file, path.join(destDir, `${session.id}.jsonl`));
  try {
    await fs.rmdir(path.dirname(session.file));
  } catch {
    // archive folder not empty; keep it
  }
}

/** Rename with a copy-and-delete fallback for cross-device moves. */
async function moveFile(from: string, to: string): Promise<void> {
  try {
    await fs.rename(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    await fs.copyFile(from, to);
    await fs.rm(from);
  }
}

/** Permanently delete a session file. */
export async function deleteSession(session: SessionEntry): Promise<void> {
  await fs.rm(session.file);
}

const MAX_SCAN_RECORDS = 200;
const MAX_MESSAGE_LENGTH = 400;

/**
 * Cheap read of the first records of a session file, enough to learn the
 * recorded working directory. Used by project discovery to resolve session
 * folders that have no history entry.
 */
export async function readSessionHead(file: string): Promise<{ cwd?: string }> {
  const detail = await scanSessionFile(file, 25);
  return { cwd: detail.cwd };
}

/**
 * Read the head of a session JSONL file and extract display metadata.
 * Session files can be huge, so only the first records are scanned.
 */
export function readSessionDetail(session: SessionEntry): Promise<SessionDetail> {
  return scanSessionFile(session.file, MAX_SCAN_RECORDS);
}

async function scanSessionFile(file: string, maxRecords: number): Promise<SessionDetail> {
  const detail: SessionDetail = { scannedRecords: 0 };
  const stream = createReadStream(file, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const line of rl) {
      if (detail.scannedRecords >= maxRecords) break;
      if (!line.trim()) continue;
      detail.scannedRecords += 1;

      let record: Record<string, unknown>;
      try {
        record = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }

      if (!detail.summary && record.type === 'summary' && typeof record.summary === 'string') {
        detail.summary = record.summary;
      }
      if (!detail.cwd && typeof record.cwd === 'string') {
        detail.cwd = record.cwd;
      }
      if (!detail.startedAt && typeof record.timestamp === 'string') {
        detail.startedAt = record.timestamp;
      }
      if (!detail.firstMessage && record.type === 'user') {
        const message = record.message as { content?: unknown } | undefined;
        const text = extractText(message?.content);
        if (text) {
          detail.firstMessage =
            text.length > MAX_MESSAGE_LENGTH ? `${text.slice(0, MAX_MESSAGE_LENGTH)}…` : text;
        }
      }

      if (detail.summary && detail.cwd && detail.firstMessage && detail.startedAt) break;
    }
  } finally {
    rl.close();
    stream.destroy();
  }

  return detail;
}

function extractText(content: unknown): string | undefined {
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
