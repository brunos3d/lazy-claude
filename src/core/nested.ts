import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { createReadStream } from 'node:fs';
import { encodeProjectPath, projectsDir } from './paths.js';
import { uniqueProjects } from './history.js';

/**
 * Detection of session folders that belong to projects nested inside a
 * given path (sub-projects, worktrees). The encoded format is lossy: a
 * sibling like /a/foo-bar shares the encoded prefix of /a/foo, so a name
 * match alone is not enough. Confirmation comes from the cwd values
 * recorded in the folder's session files, falling back to nested paths in
 * history.jsonl only when the folder records no cwd at all. A folder whose
 * cwds all point elsewhere is a sibling and is left alone.
 */

type CwdScan = 'match' | 'no-match' | 'no-cwd';

const CWD_PATTERN = /"cwd":"((?:[^"\\]|\\.)*)"/;

async function folderHasSessionUnder(folder: string, sourceAbs: string): Promise<CwdScan> {
  let names: string[];
  try {
    names = (await fs.readdir(folder)).filter((n) => n.endsWith('.jsonl'));
  } catch {
    return 'no-cwd';
  }
  const prefix = `${sourceAbs}/`;
  let foundAny = false;
  for (const name of names) {
    const stream = createReadStream(path.join(folder, name), { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const line of rl) {
        const match = CWD_PATTERN.exec(line);
        if (!match) continue;
        foundAny = true;
        let cwd: string;
        try {
          cwd = JSON.parse(`"${match[1]}"`) as string;
        } catch {
          cwd = match[1];
        }
        if (cwd.startsWith(prefix)) {
          return 'match';
        }
      }
    } finally {
      rl.close();
      stream.destroy();
    }
  }
  return foundAny ? 'no-match' : 'no-cwd';
}

async function isChildHistoryFolder(name: string, sourceAbs: string): Promise<boolean> {
  // A history entry nested under the source whose encoding equals the
  // folder name is authoritative: the encoding is deterministic, while
  // recorded cwds can be stale after an earlier move.
  const prefix = `${sourceAbs}/`;
  for (const project of await uniqueProjects()) {
    if (project.startsWith(prefix) && encodeProjectPath(project) === name) {
      return true;
    }
  }
  const scan = await folderHasSessionUnder(path.join(projectsDir(), name), sourceAbs);
  return scan === 'match';
}

/**
 * Encoded folder names of projects nested inside `sourceAbs`. Candidates
 * share the `<oldEncoded>-` prefix; each is confirmed via recorded cwds.
 */
export async function findChildHistoryFolders(
  oldEncoded: string,
  sourceAbs: string,
): Promise<string[]> {
  let names: string[];
  try {
    names = (await fs.readdir(projectsDir(), { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
  const children: string[] = [];
  for (const name of names) {
    if (!name.startsWith(`${oldEncoded}-`)) continue;
    if (await isChildHistoryFolder(name, sourceAbs)) {
      children.push(name);
    }
  }
  return children;
}
