import fs from 'node:fs/promises';
import path from 'node:path';
import { claudeDir, encodePath, projectsDir } from './paths.js';
import type { ClampProject } from './clamp.js';

/**
 * Fast local approximation of `clamp --list --json`, mirroring Clamp's logic:
 * project paths come from history.jsonl, and session folders that match no
 * known project encoding are reported as orphaned. Clamp stays the source of
 * truth; this only exists so the TUI can paint immediately while the real
 * `clamp --list` (which runs du over every project) finishes in the background.
 * projectSizeKb is left at 0 because computing it is exactly what makes clamp
 * slow.
 */
export async function quickListProjects(): Promise<ClampProject[]> {
  const historyFile = path.join(claudeDir(), 'history.jsonl');
  const knownPaths: string[] = [];
  const seen = new Set<string>();

  try {
    const history = await fs.readFile(historyFile, 'utf8');
    for (const line of history.split('\n')) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line) as { project?: string };
        if (record.project && !seen.has(record.project)) {
          seen.add(record.project);
          knownPaths.push(record.project);
        }
      } catch {
        // skip malformed history lines
      }
    }
  } catch {
    // no history file
  }

  const knownEncoded = new Set(knownPaths.map(encodePath));
  let folders: string[] = [];
  try {
    folders = await fs.readdir(projectsDir());
  } catch {
    // no projects dir
  }

  const projects = await Promise.all(
    knownPaths.map(async (projectPath): Promise<ClampProject> => {
      const encoded = encodePath(projectPath);
      const stats = await sessionFolderStats(path.join(projectsDir(), encoded));
      return {
        path: projectPath,
        exists: await pathExists(projectPath),
        sessions: stats.count,
        projectSizeKb: 0,
        sessionSizeKb: stats.sizeKb,
        lastActivity: stats.lastActivity,
        orphaned: false,
        encoded,
      };
    }),
  );

  const orphans = await Promise.all(
    folders
      .filter((encoded) => !knownEncoded.has(encoded))
      .map(async (encoded): Promise<ClampProject> => {
        const stats = await sessionFolderStats(path.join(projectsDir(), encoded));
        return {
          path: `(orphaned session: ${encoded})`,
          exists: false,
          sessions: stats.count,
          projectSizeKb: 0,
          sessionSizeKb: stats.sizeKb,
          lastActivity: stats.lastActivity,
          orphaned: true,
          encoded,
        };
      }),
  );

  return [...projects, ...orphans];
}

async function pathExists(target: string): Promise<boolean> {
  try {
    const stat = await fs.stat(target);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function sessionFolderStats(
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
