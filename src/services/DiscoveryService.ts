import fs from 'node:fs/promises';
import path from 'node:path';
import { encodeProjectPath, projectsDir } from '../core/paths.js';
import { isDirectory } from '../core/fsx.js';
import { uniqueProjects } from '../core/history.js';
import { readSessionHead } from './SessionService.js';

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

/**
 * Project discovery.
 *
 * Sources, in order:
 * 1. Project paths from history.jsonl.
 * 2. Session folders in the projects directory. Folders that match no known
 *    path encoding are resolved by reading the `cwd` recorded inside their
 *    session files. Folders with no resolvable path are reported as orphaned.
 */
export const DiscoveryService = {
  async discoverProjects(): Promise<Project[]> {
    const known = await uniqueProjects();
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
  },

  /**
   * Resolve a user-supplied query (path or encoded folder name) to a
   * discovered project. Used by CLI commands that accept either form.
   */
  async findProject(query: string): Promise<Project | null> {
    const projects = await this.discoverProjects();
    const resolved = path.resolve(query);
    return (
      projects.find((p) => p.path === resolved) ??
      projects.find((p) => p.encoded === query) ??
      null
    );
  },
};

/**
 * Read the `cwd` recorded inside the session files of a folder and return
 * it when it encodes back to the folder name.
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
