import fs from 'node:fs/promises';
import path from 'node:path';
import { encodeProjectPath, historyFile, projectsDir } from './paths.js';
import { readSessionHead } from './sessions.js';

export interface Project {
  /** Absolute project path, or a label for orphaned session folders. */
  path: string;
  /** True when the project directory exists on disk. */
  exists: boolean;
  /** Number of live session files. */
  sessions: number;
  /** Total size of the session files in KB. */
  sessionSizeKb: number;
  /** Unix timestamp (seconds) of the newest session file, 0 if unknown. */
  lastActivity: number;
  /** True when no project path could be determined for the session folder. */
  orphaned: boolean;
  /** Encoded folder name under the projects directory. */
  encoded: string;
}

/** Unique project paths recorded in history.jsonl, in file order. */
export async function historyProjectPaths(): Promise<string[]> {
  const paths: string[] = [];
  const seen = new Set<string>();
  let content: string;
  try {
    content = await fs.readFile(historyFile(), 'utf8');
  } catch {
    return paths;
  }
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line) as { project?: string };
      if (record.project && !seen.has(record.project)) {
        seen.add(record.project);
        paths.push(record.project);
      }
    } catch {
      // skip malformed history lines
    }
  }
  return paths;
}

/**
 * Discover all Claude Code projects on this machine.
 *
 * Sources, in order:
 * 1. Project paths from history.jsonl.
 * 2. Session folders in the projects directory. Folders that match no known
 *    path encoding are resolved by reading the `cwd` recorded inside their
 *    newest session file. Folders with no resolvable path are reported as
 *    orphaned.
 */
export async function discoverProjects(): Promise<Project[]> {
  const known = await historyProjectPaths();
  const knownByEncoded = new Map(known.map((p) => [encodeProjectPath(p), p]));

  let folders: string[] = [];
  try {
    folders = (await fs.readdir(projectsDir(), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    // no projects directory yet
  }

  const folderSet = new Set(folders);
  const projects: Project[] = [];

  // Projects known from history, whether or not they have a session folder.
  for (const [encoded, projectPath] of knownByEncoded) {
    const stats = await sessionFolderStats(path.join(projectsDir(), encoded));
    projects.push({
      path: projectPath,
      exists: await isDirectory(projectPath),
      sessions: stats.count,
      sessionSizeKb: stats.sizeKb,
      lastActivity: stats.lastActivity,
      orphaned: false,
      encoded,
    });
    folderSet.delete(encoded);
  }

  // Session folders with no history entry: try to resolve via recorded cwd.
  for (const encoded of folderSet) {
    const dir = path.join(projectsDir(), encoded);
    const stats = await sessionFolderStats(dir);
    const cwd = await sniffProjectPath(dir, encoded);
    projects.push({
      path: cwd ?? `(orphaned: ${encoded})`,
      exists: cwd ? await isDirectory(cwd) : false,
      sessions: stats.count,
      sessionSizeKb: stats.sizeKb,
      lastActivity: stats.lastActivity,
      orphaned: cwd === null,
      encoded,
    });
  }

  return projects;
}

/**
 * Read the `cwd` recorded inside the newest session file of a folder and
 * return it when it encodes back to the folder name.
 */
async function sniffProjectPath(dir: string, encoded: string): Promise<string | null> {
  let names: string[];
  try {
    names = (await fs.readdir(dir)).filter((n) => n.endsWith('.jsonl'));
  } catch {
    return null;
  }
  for (const name of names.slice(0, 5)) {
    try {
      const head = await readSessionHead(path.join(dir, name));
      if (head.cwd && encodeProjectPath(head.cwd) === encoded) {
        return head.cwd;
      }
    } catch {
      // unreadable session file; try the next one
    }
  }
  return null;
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isDirectory();
  } catch {
    return false;
  }
}

export async function sessionFolderStats(
  dir: string,
): Promise<{ count: number; sizeKb: number; lastActivity: number }> {
  let count = 0;
  let sizeBytes = 0;
  let lastActivity = 0;
  try {
    const names = await fs.readdir(dir);
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue;
      try {
        const stat = await fs.stat(path.join(dir, name));
        count += 1;
        sizeBytes += stat.size;
        lastActivity = Math.max(lastActivity, Math.floor(stat.mtimeMs / 1000));
      } catch {
        // file vanished; skip
      }
    }
  } catch {
    // folder missing
  }
  return { count, sizeKb: Math.round(sizeBytes / 1024), lastActivity };
}
