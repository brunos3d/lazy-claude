import path from 'node:path';
import fs from 'node:fs/promises';
import { archiveDir, historyFile, projectsDir } from '../core/paths.js';
import { isDirectory, mergeDir, moveDir } from '../core/fsx.js';
import { readHistoryLines, rewriteProjectPrefix } from '../core/history.js';
import { findChildHistoryFolders } from '../core/nested.js';
import { Journal } from '../core/journal.js';

/**
 * Shared reference-relocation logic used by move and repair: rename the
 * session folder (merging when the destination folder already exists),
 * migrate nested sub-project and worktree folders, mirror the renames in
 * the Lazy Claude archive, and rewrite history.jsonl.
 */

export interface RelocatePlan {
  oldEncoded: string;
  newEncoded: string;
  folderRenames: Array<{ from: string; to: string; merge: boolean }>;
  archiveRenames: Array<{ from: string; to: string; merge: boolean }>;
  historyEntries: { exact: number; nested: number };
}

export async function planRelocation(
  oldPath: string,
  oldEncoded: string,
  newEncoded: string,
): Promise<Pick<RelocatePlan, 'folderRenames' | 'archiveRenames'>> {
  const folderRenames: RelocatePlan['folderRenames'] = [];
  const archiveRenames: RelocatePlan['archiveRenames'] = [];

  const addRename = async (
    base: string,
    from: string,
    to: string,
    bucket: RelocatePlan['folderRenames'],
  ) => {
    if (await isDirectory(path.join(base, from))) {
      bucket.push({ from, to, merge: await isDirectory(path.join(base, to)) });
    }
  };

  await addRename(projectsDir(), oldEncoded, newEncoded, folderRenames);
  await addRename(archiveDir(), oldEncoded, newEncoded, archiveRenames);

  for (const child of await findChildHistoryFolders(oldEncoded, oldPath)) {
    const newChild = newEncoded + child.slice(oldEncoded.length);
    await addRename(projectsDir(), child, newChild, folderRenames);
    await addRename(archiveDir(), child, newChild, archiveRenames);
  }

  return { folderRenames, archiveRenames };
}

async function applyRename(
  base: string,
  rename: { from: string; to: string; merge: boolean },
  journal: Journal,
  steps: string[],
  label: string,
): Promise<void> {
  const from = path.join(base, rename.from);
  const to = path.join(base, rename.to);
  if (rename.merge || (await isDirectory(to))) {
    const { moved, skipped } = await mergeDir(from, to);
    journal.record(`unmerge ${rename.from}`, async () => {
      await fs.mkdir(from, { recursive: true });
      for (let i = moved.length - 1; i >= 0; i--) {
        await fs.rename(moved[i].to, moved[i].from);
      }
    });
    steps.push(
      `Merged ${label} ${rename.from} into ${rename.to}` +
        (skipped.length > 0 ? ` (${skipped.length} entries already existed and were kept)` : ''),
    );
  } else {
    await moveDir(from, to);
    journal.record(`restore ${rename.from}`, () => moveDir(to, from));
    steps.push(`Renamed ${label} ${rename.from} to ${rename.to}`);
  }
}

/**
 * Execute the folder renames and the history rewrite. The caller has
 * already created a history backup; the journal restores history from the
 * in-memory snapshot taken here.
 */
export async function executeRelocation(
  oldPath: string,
  newPath: string,
  plan: Pick<RelocatePlan, 'folderRenames' | 'archiveRenames'>,
  journal: Journal,
  steps: string[],
): Promise<void> {
  for (const rename of plan.folderRenames) {
    await applyRename(projectsDir(), rename, journal, steps, 'session folder');
  }
  for (const rename of plan.archiveRenames) {
    await applyRename(archiveDir(), rename, journal, steps, 'archive folder');
  }

  const before = await readHistoryLines();
  const changed = await rewriteProjectPrefix(oldPath, newPath);
  if (changed > 0) {
    journal.record('restore history.jsonl', () =>
      fs.writeFile(historyFile(), before.length ? `${before.join('\n')}\n` : '', 'utf8'),
    );
    steps.push(`Updated ${changed} history entries`);
  }
}
