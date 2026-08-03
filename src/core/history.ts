import fs from 'node:fs/promises';
import { historyFile } from './paths.js';

/**
 * Helpers for Claude Code's history.jsonl. Every mutation works line by
 * line and preserves lines it does not understand, so unknown record
 * shapes survive untouched.
 */

export async function readHistoryLines(): Promise<string[]> {
  try {
    const content = await fs.readFile(historyFile(), 'utf8');
    return content.split('\n').filter((line) => line.trim().length > 0);
  } catch {
    return [];
  }
}

export function projectOfLine(line: string): string | null {
  try {
    const record = JSON.parse(line) as { project?: string };
    return typeof record.project === 'string' ? record.project : null;
  } catch {
    return null;
  }
}

/** Unique project paths in file order. */
export async function uniqueProjects(): Promise<string[]> {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const line of await readHistoryLines()) {
    const project = projectOfLine(line);
    if (project && !seen.has(project)) {
      seen.add(project);
      result.push(project);
    }
  }
  return result;
}

/** Case-insensitive lookup of the canonical casing stored in history. */
export async function canonicalCasing(projectPath: string): Promise<string | null> {
  const lower = projectPath.toLowerCase();
  for (const project of await uniqueProjects()) {
    if (project.toLowerCase() === lower) return project;
  }
  return null;
}

/** Count entries whose project is exactly `p` or nested under it. */
export async function countEntries(p: string): Promise<{ exact: number; nested: number }> {
  let exact = 0;
  let nested = 0;
  const prefix = `${p}/`;
  for (const line of await readHistoryLines()) {
    const project = projectOfLine(line);
    if (project === p) exact += 1;
    else if (project?.startsWith(prefix)) nested += 1;
  }
  return { exact, nested };
}

async function writeHistoryLines(lines: string[]): Promise<void> {
  const content = lines.length > 0 ? `${lines.join('\n')}\n` : '';
  await fs.writeFile(historyFile(), content, 'utf8');
}

/**
 * Rewrite project references from `oldPath` to `newPath`, both the exact
 * path and paths nested under it. Returns the number of changed entries.
 */
export async function rewriteProjectPrefix(oldPath: string, newPath: string): Promise<number> {
  const lines = await readHistoryLines();
  if (lines.length === 0) return 0;
  const prefix = `${oldPath}/`;
  let changed = 0;
  const updated = lines.map((line) => {
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return line;
    }
    const project = record.project;
    if (typeof project !== 'string') return line;
    if (project === oldPath) {
      record.project = newPath;
    } else if (project.startsWith(prefix)) {
      record.project = newPath + project.slice(oldPath.length);
    } else {
      return line;
    }
    changed += 1;
    return JSON.stringify(record);
  });
  if (changed > 0) await writeHistoryLines(updated);
  return changed;
}

/** Remove every entry whose project is exactly `p`. Returns removed count. */
export async function removeEntries(p: string): Promise<number> {
  const lines = await readHistoryLines();
  if (lines.length === 0) return 0;
  const kept = lines.filter((line) => projectOfLine(line) !== p);
  const removed = lines.length - kept.length;
  if (removed > 0) await writeHistoryLines(kept);
  return removed;
}

/** All raw lines whose project is exactly `p` (used by pack). */
export async function entriesFor(p: string): Promise<string[]> {
  const result: string[] = [];
  for (const line of await readHistoryLines()) {
    if (projectOfLine(line) === p) result.push(line);
  }
  return result;
}

/** Append raw JSONL lines to the history file. */
export async function appendEntries(lines: string[]): Promise<void> {
  if (lines.length === 0) return;
  await fs.appendFile(historyFile(), `${lines.join('\n')}\n`, 'utf8');
}
