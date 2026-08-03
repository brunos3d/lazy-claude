import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as tar from 'tar';
import { encodeProjectPath, projectsDir } from '../core/paths.js';
import { exists, isDirectory } from '../core/fsx.js';
import { appendEntries, entriesFor } from '../core/history.js';
import { Journal } from '../core/journal.js';
import { BackupService } from './BackupService.js';

export interface PackOptions {
  source: string;
  /** Archive path; defaults to ./<project-name>.claudepack */
  archive?: string;
  force?: boolean;
}

export interface PackReport {
  source: string;
  archive: string;
  historyEntries: number;
  steps: string[];
}

export interface UnpackOptions {
  archive: string;
  destination: string;
  force?: boolean;
  parents?: boolean;
  backup?: boolean;
}

export interface UnpackReport {
  archive: string;
  destination: string;
  steps: string[];
  backupFile: string | null;
}

interface Manifest {
  version: string;
  pack_date: string;
  original_path: string;
  encoded_path: string;
  project_name: string;
}

const PACK_VERSION = '1.0.0';

/**
 * Portable .claudepack archives (tar.gz), format-compatible with the
 * layout other tools use: manifest.json, project/, sessions/, and
 * history-entries.jsonl. Unpacking rewrites recorded paths to the new
 * destination.
 */
export const PackService = {
  async pack(options: PackOptions): Promise<PackReport> {
    const source = path.resolve(options.source);
    if (!(await isDirectory(source))) {
      throw new Error(`Source directory does not exist: ${options.source}`);
    }
    const encoded = encodeProjectPath(source);
    const projectName = path.basename(source);

    let archive = path.resolve(options.archive ?? `${projectName}.claudepack`);
    if (!archive.endsWith('.claudepack')) archive = `${archive}.claudepack`;
    if ((await exists(archive)) && !options.force) {
      throw new Error(`Archive already exists: ${archive} (use --force to overwrite)`);
    }

    const steps: string[] = [];
    const staging = await fs.mkdtemp(path.join(os.tmpdir(), 'lazy-claude-pack-'));
    try {
      await fs.cp(source, path.join(staging, 'project'), { recursive: true });
      steps.push('Copied project folder');

      const sessionsSrc = path.join(projectsDir(), encoded);
      await fs.mkdir(path.join(staging, 'sessions'), { recursive: true });
      if (await isDirectory(sessionsSrc)) {
        await fs.cp(sessionsSrc, path.join(staging, 'sessions'), { recursive: true });
        steps.push('Copied session folder');
      } else {
        steps.push('No session history found; packing project only');
      }

      const entries = await entriesFor(source);
      await fs.writeFile(
        path.join(staging, 'history-entries.jsonl'),
        entries.length > 0 ? `${entries.join('\n')}\n` : '',
        'utf8',
      );
      steps.push(`Extracted ${entries.length} history entries`);

      const manifest: Manifest = {
        version: PACK_VERSION,
        pack_date: new Date().toISOString(),
        original_path: source,
        encoded_path: encoded,
        project_name: projectName,
      };
      await fs.writeFile(
        path.join(staging, 'manifest.json'),
        `${JSON.stringify(manifest, null, 2)}\n`,
        'utf8',
      );

      await tar.create(
        { gzip: true, file: archive, cwd: staging },
        ['manifest.json', 'project', 'sessions', 'history-entries.jsonl'],
      );
      steps.push(`Created archive: ${archive}`);

      return { source, archive, historyEntries: entries.length, steps };
    } finally {
      await fs.rm(staging, { recursive: true, force: true });
    }
  },

  async readManifest(archive: string): Promise<Manifest> {
    const resolved = path.resolve(archive);
    if (!(await exists(resolved))) {
      throw new Error(`Archive file does not exist: ${archive}`);
    }
    const staging = await fs.mkdtemp(path.join(os.tmpdir(), 'lazy-claude-manifest-'));
    try {
      await tar.extract({ file: resolved, cwd: staging }, ['manifest.json']);
      const raw = await fs.readFile(path.join(staging, 'manifest.json'), 'utf8');
      return JSON.parse(raw) as Manifest;
    } catch (error) {
      throw new Error(
        `Invalid archive: missing manifest.json or not a valid .claudepack file (${(error as Error).message})`,
      );
    } finally {
      await fs.rm(staging, { recursive: true, force: true });
    }
  },

  async unpack(options: UnpackOptions): Promise<UnpackReport> {
    const archive = path.resolve(options.archive);
    const manifest = await this.readManifest(archive);

    let destination = path.resolve(options.destination);
    if (await exists(destination)) {
      if (!options.force) {
        throw new Error(`Destination already exists: ${destination} (use --force to overwrite)`);
      }
    }
    const destParent = path.dirname(destination);
    if (!(await isDirectory(destParent)) && !options.parents) {
      throw new Error(
        `Destination parent directory does not exist: ${destParent} (use --parents to create it)`,
      );
    }

    const newEncoded = encodeProjectPath(destination);
    const sessionsDest = path.join(projectsDir(), newEncoded);
    if ((await isDirectory(sessionsDest)) && !options.force) {
      throw new Error(`Session folder already exists: ${sessionsDest} (use --force to overwrite)`);
    }

    const steps: string[] = [];
    const journal = new Journal();
    const staging = await fs.mkdtemp(path.join(os.tmpdir(), 'lazy-claude-unpack-'));
    let backupFile: string | null = null;
    try {
      await tar.extract({ file: archive, cwd: staging });
      steps.push('Extracted archive');

      if (options.backup !== false) {
        backupFile = await BackupService.create();
        if (backupFile) steps.push(`Created backup: ${backupFile}`);
      }

      if (await exists(destination)) {
        await fs.rm(destination, { recursive: true, force: true });
      }
      await fs.mkdir(destParent, { recursive: true });
      await fs.cp(path.join(staging, 'project'), destination, { recursive: true });
      journal.record('remove partially unpacked project', () =>
        fs.rm(destination, { recursive: true, force: true }),
      );
      steps.push(`Copied project to ${destination}`);

      const stagedSessions = path.join(staging, 'sessions');
      const sessionNames = (await isDirectory(stagedSessions))
        ? await fs.readdir(stagedSessions)
        : [];
      if (sessionNames.length > 0) {
        if (await isDirectory(sessionsDest)) {
          await fs.rm(sessionsDest, { recursive: true, force: true });
        }
        await fs.cp(stagedSessions, sessionsDest, { recursive: true });
        journal.record('remove partially created session folder', () =>
          fs.rm(sessionsDest, { recursive: true, force: true }),
        );

        if (manifest.original_path && manifest.original_path !== destination) {
          const rewritten = await rewritePathsInDir(
            sessionsDest,
            manifest.original_path,
            destination,
          );
          steps.push(`Rewrote paths in ${rewritten} session file(s)`);
        }
        steps.push('Copied session folder');
      }

      const entriesRaw = await fs
        .readFile(path.join(staging, 'history-entries.jsonl'), 'utf8')
        .catch(() => '');
      const entries = entriesRaw
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => rewriteEntryPath(line, manifest.original_path, destination));
      if (entries.length > 0) {
        await appendEntries(entries);
        steps.push(`Appended ${entries.length} history entries`);
      }

      return { archive, destination, steps, backupFile };
    } catch (error) {
      const rollbackErrors = await journal.rollback();
      const suffix =
        rollbackErrors.length > 0
          ? ` Rollback issues: ${rollbackErrors.join('; ')}`
          : ' Partial changes were rolled back.';
      throw new Error(`Unpack failed: ${(error as Error).message}.${suffix}`);
    } finally {
      await fs.rm(staging, { recursive: true, force: true });
    }
  },
};

/** Rewrite the project field of one history entry, preserving unknown lines. */
function rewriteEntryPath(line: string, oldPath: string, newPath: string): string {
  if (!oldPath || oldPath === newPath) return line;
  try {
    const record = JSON.parse(line) as Record<string, unknown>;
    if (typeof record.project === 'string') {
      if (record.project === oldPath) record.project = newPath;
      else if (record.project.startsWith(`${oldPath}/`)) {
        record.project = newPath + record.project.slice(oldPath.length);
      }
    }
    return JSON.stringify(record);
  } catch {
    return line.replaceAll(oldPath, newPath);
  }
}

/** Replace oldPath with newPath in every JSONL file under dir. */
async function rewritePathsInDir(dir: string, oldPath: string, newPath: string): Promise<number> {
  let rewritten = 0;
  const names = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of names) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      rewritten += await rewritePathsInDir(full, oldPath, newPath);
    } else if (entry.name.endsWith('.jsonl')) {
      const content = await fs.readFile(full, 'utf8');
      if (content.includes(oldPath)) {
        await fs.writeFile(full, content.replaceAll(oldPath, newPath), 'utf8');
        rewritten += 1;
      }
    }
  }
  return rewritten;
}
