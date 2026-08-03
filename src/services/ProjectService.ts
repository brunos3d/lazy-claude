import fs from 'node:fs/promises';
import path from 'node:path';
import { archiveDir, encodeProjectPath, projectsDir } from '../core/paths.js';
import { dirSizeKb, exists, isDirectory } from '../core/fsx.js';
import { countEntries, removeEntries } from '../core/history.js';
import { BackupService } from './BackupService.js';

export interface ProjectInfo {
  path: string;
  encoded: string;
  projectExists: boolean;
  projectSizeKb: number;
  hasClaudeSettings: boolean;
  sessionFolderExists: boolean;
  sessionCount: number;
  sessionSizeKb: number;
  archivedCount: number;
  newestSession: Date | null;
  oldestSession: Date | null;
  historyEntries: { exact: number; nested: number };
}

export interface RemoveOptions {
  path: string;
  dryRun?: boolean;
  backup?: boolean;
}

export interface RemoveReport {
  path: string;
  dryRun: boolean;
  steps: string[];
  backupFile: string | null;
}

/** Project-level inspection and removal. */
export const ProjectService = {
  async info(projectPath: string): Promise<ProjectInfo> {
    const resolved = path.resolve(projectPath);
    const encoded = encodeProjectPath(resolved);
    const sessionFolder = path.join(projectsDir(), encoded);
    const archiveFolder = path.join(archiveDir(), encoded);

    const projectExists = await isDirectory(resolved);
    const sessionFolderExists = await isDirectory(sessionFolder);

    let sessionCount = 0;
    let newestSession: Date | null = null;
    let oldestSession: Date | null = null;
    if (sessionFolderExists) {
      for (const name of await fs.readdir(sessionFolder)) {
        if (!name.endsWith('.jsonl')) continue;
        try {
          const stat = await fs.stat(path.join(sessionFolder, name));
          sessionCount += 1;
          if (!newestSession || stat.mtime > newestSession) newestSession = stat.mtime;
          if (!oldestSession || stat.mtime < oldestSession) oldestSession = stat.mtime;
        } catch {
          // vanished
        }
      }
    }

    let archivedCount = 0;
    if (await isDirectory(archiveFolder)) {
      archivedCount = (await fs.readdir(archiveFolder)).filter((n) =>
        n.endsWith('.jsonl'),
      ).length;
    }

    return {
      path: resolved,
      encoded,
      projectExists,
      projectSizeKb: projectExists ? await dirSizeKb(resolved) : 0,
      hasClaudeSettings: await exists(path.join(resolved, '.claude')),
      sessionFolderExists,
      sessionCount,
      sessionSizeKb: sessionFolderExists ? await dirSizeKb(sessionFolder) : 0,
      archivedCount,
      newestSession,
      oldestSession,
      historyEntries: await countEntries(resolved),
    };
  },

  /**
   * Permanently delete a project: its history entries, session folder,
   * archived sessions, and the project directory itself.
   */
  async remove(options: RemoveOptions): Promise<RemoveReport> {
    const resolved = path.resolve(options.path);
    const encoded = encodeProjectPath(resolved);
    const sessionFolder = path.join(projectsDir(), encoded);
    const archiveFolder = path.join(archiveDir(), encoded);
    const dryRun = options.dryRun ?? false;
    const steps: string[] = [];

    if (!(await isDirectory(resolved))) {
      throw new Error(`Project directory does not exist: ${options.path}`);
    }

    if (dryRun) {
      const counts = await countEntries(resolved);
      steps.push(`Would remove ${counts.exact} history entries`);
      if (await isDirectory(sessionFolder)) steps.push(`Would delete ${sessionFolder}`);
      if (await isDirectory(archiveFolder)) steps.push(`Would delete ${archiveFolder}`);
      steps.push(`Would delete ${resolved}`);
      return { path: resolved, dryRun, steps, backupFile: null };
    }

    let backupFile: string | null = null;
    if (options.backup !== false) {
      backupFile = await BackupService.create();
      if (backupFile) steps.push(`Created backup: ${backupFile}`);
    }

    const removed = await removeEntries(resolved);
    if (removed > 0) steps.push(`Removed ${removed} history entries`);

    if (await isDirectory(sessionFolder)) {
      await fs.rm(sessionFolder, { recursive: true, force: true });
      steps.push(`Deleted session folder ${sessionFolder}`);
    }
    if (await isDirectory(archiveFolder)) {
      await fs.rm(archiveFolder, { recursive: true, force: true });
      steps.push(`Deleted archived sessions ${archiveFolder}`);
    }
    await fs.rm(resolved, { recursive: true, force: true });
    steps.push(`Deleted project folder ${resolved}`);

    return { path: resolved, dryRun, steps, backupFile };
  },
};
