import fs from 'node:fs/promises';
import path from 'node:path';
import { encodeProjectPath, projectsDir } from '../core/paths.js';
import { exists, isDirectory, moveDir } from '../core/fsx.js';
import { canonicalCasing, countEntries, readHistoryLines } from '../core/history.js';
import { Journal } from '../core/journal.js';
import { BackupService } from './BackupService.js';
import { executeRelocation, planRelocation } from './relocate.js';

export interface MoveOptions {
  source: string;
  /** Destination path. Ignored when `here` is set. */
  destination?: string;
  /** Move the project into the current working directory. */
  here?: boolean;
  /** Create missing parent directories of the destination. */
  parents?: boolean;
  dryRun?: boolean;
  /** Create a history.jsonl backup first (default true). */
  backup?: boolean;
}

export interface MoveReport {
  source: string;
  destination: string;
  dryRun: boolean;
  steps: string[];
  backupFile: string | null;
}

/**
 * Move a project directory and migrate every Claude Code reference:
 * the session folder (and nested sub-project/worktree folders), archived
 * sessions, and history.jsonl entries. Rolls back on failure.
 */
export const MoveService = {
  /** Resolve and validate paths, returning the concrete source/destination pair. */
  async resolve(options: MoveOptions): Promise<{ source: string; destination: string }> {
    let source = path.resolve(options.source);
    if (!(await isDirectory(source))) {
      throw new Error(`Source directory does not exist: ${options.source}`);
    }

    // On case-insensitive filesystems the shell may resolve a different
    // casing than Claude Code recorded. Prefer the canonical history casing.
    const history = await readHistoryLines();
    if (!history.some((line) => line.includes(`"project":${JSON.stringify(source)}`))) {
      const canonical = await canonicalCasing(source);
      if (canonical) source = canonical;
    }

    let destination = options.here
      ? process.cwd()
      : path.resolve(options.destination ?? '');
    if (!options.here && !options.destination) {
      throw new Error('Destination path required');
    }

    // mv-like behavior: moving into an existing directory.
    if (await isDirectory(destination)) {
      destination = path.join(destination, path.basename(source));
    }
    if (await exists(destination)) {
      throw new Error(`Destination already exists: ${destination}`);
    }
    if (source === destination) {
      throw new Error(`Source and destination are the same: ${source}`);
    }
    return { source, destination };
  },

  async move(options: MoveOptions): Promise<MoveReport> {
    const { source, destination } = await this.resolve(options);
    const oldEncoded = encodeProjectPath(source);
    const newEncoded = encodeProjectPath(destination);
    const dryRun = options.dryRun ?? false;
    const steps: string[] = [];

    const destParent = path.dirname(destination);
    const parentMissing = !(await isDirectory(destParent));
    if (parentMissing && !options.parents) {
      throw new Error(
        `Destination parent directory does not exist: ${destParent} (use --parents to create it)`,
      );
    }

    const plan = await planRelocation(source, oldEncoded, newEncoded);
    const counts = await countEntries(source);

    if (dryRun) {
      if (parentMissing) steps.push(`Would create parent directories: ${destParent}`);
      steps.push(`Would move project to ${destination}`);
      for (const r of plan.folderRenames) {
        steps.push(`Would ${r.merge ? 'merge' : 'rename'} session folder ${r.from} -> ${r.to}`);
      }
      for (const r of plan.archiveRenames) {
        steps.push(`Would ${r.merge ? 'merge' : 'rename'} archive folder ${r.from} -> ${r.to}`);
      }
      if (plan.folderRenames.length === 0) {
        steps.push('No session history found for this project');
      }
      steps.push(`Would update ${counts.exact + counts.nested} history entries`);
      return { source, destination, dryRun, steps, backupFile: null };
    }

    const journal = new Journal();
    let backupFile: string | null = null;
    try {
      if (options.backup !== false) {
        backupFile = await BackupService.create();
        if (backupFile) steps.push(`Created backup: ${backupFile}`);
      }

      if (parentMissing) {
        await fs.mkdir(destParent, { recursive: true });
        steps.push(`Created parent directories: ${destParent}`);
      }

      await moveDir(source, destination);
      journal.record('restore project folder', () => moveDir(destination, source));
      steps.push(`Moved project to ${destination}`);

      if (plan.folderRenames.length === 0) {
        steps.push(`No session history found (looked for ${path.join(projectsDir(), oldEncoded)})`);
      }
      await executeRelocation(source, destination, plan, journal, steps);

      return { source, destination, dryRun, steps, backupFile };
    } catch (error) {
      const rollbackErrors = await journal.rollback();
      const suffix =
        rollbackErrors.length > 0
          ? ` Rollback issues: ${rollbackErrors.join('; ')}`
          : ' All changes were rolled back.';
      throw new Error(`Move failed: ${(error as Error).message}.${suffix}`);
    }
  },
};
