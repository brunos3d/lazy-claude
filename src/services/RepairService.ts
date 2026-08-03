import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { encodeProjectPath } from '../core/paths.js';
import { isDirectory } from '../core/fsx.js';
import { countEntries, uniqueProjects } from '../core/history.js';
import { Journal } from '../core/journal.js';
import { BackupService } from './BackupService.js';
import { executeRelocation, planRelocation } from './relocate.js';

export interface RepairOptions {
  /** The old path that no longer exists. */
  from: string;
  /** The path where the project lives now. */
  to: string;
  dryRun?: boolean;
  backup?: boolean;
}

export interface RepairReport {
  from: string;
  to: string;
  dryRun: boolean;
  changes: number;
  steps: string[];
  backupFile: string | null;
}

export interface BrokenReference {
  /** Project path recorded in history that no longer exists on disk. */
  path: string;
  name: string;
}

/**
 * Repair Claude Code references after a project was moved manually:
 * rename or merge session folders (including nested ones), mirror archive
 * folders, and rewrite history.jsonl. Also finds broken references and
 * candidate locations for them.
 */
export const RepairService = {
  /** History entries whose project directory no longer exists. */
  async findBrokenReferences(): Promise<BrokenReference[]> {
    const broken: BrokenReference[] = [];
    for (const project of await uniqueProjects()) {
      if (!(await isDirectory(project))) {
        broken.push({ path: project, name: path.basename(project) });
      }
    }
    return broken;
  },

  /**
   * Directories on disk that could be the new home of a broken reference:
   * same basename, searched near the old location and in common project
   * roots, three levels deep.
   */
  async findCandidates(broken: BrokenReference): Promise<string[]> {
    const home = os.homedir();
    const parent = path.dirname(broken.path);
    const roots = [
      parent,
      path.dirname(parent),
      home,
      path.join(home, 'Documents'),
      path.join(home, 'Projects'),
      path.join(home, 'projects'),
      path.join(home, 'code'),
      path.join(home, 'dev'),
      path.join(home, 'workspace'),
    ];
    const seen = new Set<string>();
    const matches: string[] = [];
    for (const root of roots) {
      if (!(await isDirectory(root))) continue;
      await searchByName(root, broken.name, 3, (found) => {
        if (found !== broken.path && !seen.has(found)) {
          seen.add(found);
          matches.push(found);
        }
      });
    }
    return matches;
  },

  /**
   * Broken references whose basename matches the given path, for the
   * "I know where it is now" flow.
   */
  async matchBrokenByName(newPath: string): Promise<BrokenReference[]> {
    const name = path.basename(path.resolve(newPath));
    return (await this.findBrokenReferences()).filter((b) => b.name === name);
  },

  async repair(options: RepairOptions): Promise<RepairReport> {
    const from = path.resolve(options.from);
    const to = path.resolve(options.to);
    if (!(await isDirectory(to))) {
      throw new Error(`Destination path does not exist: ${to}`);
    }

    const oldEncoded = encodeProjectPath(from);
    const newEncoded = encodeProjectPath(to);
    const plan = await planRelocation(from, oldEncoded, newEncoded);
    const counts = await countEntries(from);
    const changes =
      plan.folderRenames.length + plan.archiveRenames.length + counts.exact + counts.nested;
    const dryRun = options.dryRun ?? false;
    const steps: string[] = [];

    if (changes === 0) {
      return {
        from,
        to,
        dryRun,
        changes,
        steps: ['Nothing to fix: references already correct'],
        backupFile: null,
      };
    }

    if (dryRun) {
      for (const r of plan.folderRenames) {
        steps.push(`Would ${r.merge ? 'merge' : 'rename'} session folder ${r.from} -> ${r.to}`);
      }
      for (const r of plan.archiveRenames) {
        steps.push(`Would ${r.merge ? 'merge' : 'rename'} archive folder ${r.from} -> ${r.to}`);
      }
      steps.push(`Would update ${counts.exact + counts.nested} history entries`);
      return { from, to, dryRun, changes, steps, backupFile: null };
    }

    const journal = new Journal();
    let backupFile: string | null = null;
    try {
      if (options.backup !== false) {
        backupFile = await BackupService.create();
        if (backupFile) steps.push(`Created backup: ${backupFile}`);
      }
      await executeRelocation(from, to, plan, journal, steps);
      return { from, to, dryRun, changes, steps, backupFile };
    } catch (error) {
      const rollbackErrors = await journal.rollback();
      const suffix =
        rollbackErrors.length > 0
          ? ` Rollback issues: ${rollbackErrors.join('; ')}`
          : ' All changes were rolled back.';
      throw new Error(`Repair failed: ${(error as Error).message}.${suffix}`);
    }
  },
};

async function searchByName(
  root: string,
  name: string,
  maxDepth: number,
  onMatch: (dir: string) => void,
): Promise<void> {
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  while (queue.length > 0) {
    const { dir, depth } = queue.shift()!;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.name === name) onMatch(full);
      if (depth + 1 < maxDepth) queue.push({ dir: full, depth: depth + 1 });
    }
  }
}
