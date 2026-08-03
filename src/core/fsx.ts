import fs from 'node:fs/promises';
import path from 'node:path';

/** True when the path exists and is a directory. */
export async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isDirectory();
  } catch {
    return false;
  }
}

/** True when the path exists (any kind). */
export async function exists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);
    return true;
  } catch {
    return false;
  }
}

/** Rename with a copy-and-delete fallback for cross-device moves. */
export async function moveFile(from: string, to: string): Promise<void> {
  try {
    await fs.rename(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    await fs.copyFile(from, to);
    await fs.rm(from);
  }
}

/** Move a directory, falling back to copy-and-delete across devices. */
export async function moveDir(from: string, to: string): Promise<void> {
  try {
    await fs.rename(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    await fs.cp(from, to, { recursive: true, preserveTimestamps: true });
    await fs.rm(from, { recursive: true });
  }
}

/**
 * Merge the contents of one directory into another that already exists.
 * Entries that already exist at the destination are left in place at the
 * source. Returns the moved pairs (for rollback) and the names left behind.
 * The source directory is removed when it ends up empty.
 */
export async function mergeDir(
  src: string,
  dst: string,
): Promise<{ moved: Array<{ from: string; to: string }>; skipped: string[] }> {
  const moved: Array<{ from: string; to: string }> = [];
  const skipped: string[] = [];
  const entries = await fs.readdir(src);
  for (const name of entries) {
    const from = path.join(src, name);
    const to = path.join(dst, name);
    if (await exists(to)) {
      skipped.push(name);
      continue;
    }
    await moveFile(from, to).catch(async (error) => {
      // Directories need moveDir; moveFile's copyFile fails on them.
      if ((error as NodeJS.ErrnoException).code === 'EISDIR') {
        await moveDir(from, to);
      } else {
        throw error;
      }
    });
    moved.push({ from, to });
  }
  try {
    await fs.rmdir(src);
  } catch {
    // not empty (skipped entries remain); keep it
  }
  return { moved, skipped };
}

/** Total size of all files under a directory, in KB. Follows no symlinks. */
export async function dirSizeKb(dir: string): Promise<number> {
  let bytes = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        try {
          bytes += (await fs.stat(full)).size;
        } catch {
          // vanished
        }
      }
    }
  }
  return Math.round(bytes / 1024);
}
