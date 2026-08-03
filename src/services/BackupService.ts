import fs from 'node:fs/promises';
import path from 'node:path';
import { claudeDir, historyFile } from '../core/paths.js';
import { exists } from '../core/fsx.js';

export interface Backup {
  file: string;
  name: string;
  createdAt: Date;
  sizeBytes: number;
}

const BACKUP_PATTERN = /^history\.jsonl\.backup\.(\d{8}-\d{6})$/;

function timestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/**
 * Timestamped copies of history.jsonl, stored next to it as
 * history.jsonl.backup.YYYYMMDD-HHMMSS. Every mutating operation creates
 * one first (unless the caller opts out), and restore copies one back.
 */
export const BackupService = {
  /** Copy history.jsonl aside. Returns the backup path, or null if there is no history file. */
  async create(): Promise<string | null> {
    const source = historyFile();
    if (!(await exists(source))) return null;
    let file = `${source}.backup.${timestamp(new Date())}`;
    // Avoid clobbering a backup created in the same second.
    while (await exists(file)) {
      file = `${file}b`;
    }
    await fs.copyFile(source, file);
    return file;
  },

  /** All backups, newest first. */
  async list(): Promise<Backup[]> {
    let names: string[];
    try {
      names = await fs.readdir(claudeDir());
    } catch {
      return [];
    }
    const backups: Backup[] = [];
    for (const name of names) {
      if (!name.startsWith('history.jsonl.backup.')) continue;
      const file = path.join(claudeDir(), name);
      try {
        const stat = await fs.stat(file);
        if (!stat.isFile()) continue;
        backups.push({ file, name, createdAt: stat.mtime, sizeBytes: stat.size });
      } catch {
        // vanished
      }
    }
    backups.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return backups;
  },

  /**
   * Replace history.jsonl with a backup. The current file is backed up
   * first so a restore is itself reversible.
   */
  async restore(backupFile: string): Promise<{ preRestoreBackup: string | null }> {
    if (!(await exists(backupFile))) {
      throw new Error(`Backup not found: ${backupFile}`);
    }
    const preRestoreBackup = await this.create();
    await fs.copyFile(backupFile, historyFile());
    return { preRestoreBackup };
  },

  async delete(backupFile: string): Promise<void> {
    const name = path.basename(backupFile);
    if (!name.startsWith('history.jsonl.backup.')) {
      throw new Error(`Not a history backup file: ${backupFile}`);
    }
    await fs.rm(backupFile);
  },

  isBackupName(name: string): boolean {
    return BACKUP_PATTERN.test(name) || name.startsWith('history.jsonl.backup.');
  },
};
