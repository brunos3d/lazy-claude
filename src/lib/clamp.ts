import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Candidate locations for the Clamp script, in priority order.
 *
 * The local clone comes before PATH on purpose: the fixes from
 * https://github.com/wsagency/claude-move-project/pull/15 are not merged
 * upstream yet, so the local repository version is the source of truth.
 * Once the PR lands in a release, the PATH fallback takes over naturally.
 */
function clampCandidates(): string[] {
  const candidates: string[] = [];
  if (process.env.LAZY_CLAMP_BIN) {
    candidates.push(process.env.LAZY_CLAMP_BIN);
  }
  candidates.push(path.join(os.homedir(), 'github', 'cloned', 'claude-move-project', 'clamp'));
  return candidates;
}

let cachedClampPath: string | null | undefined;

/** Resolve the Clamp executable, or null if none is available. */
export function resolveClamp(): string | null {
  if (cachedClampPath !== undefined) return cachedClampPath;

  for (const candidate of clampCandidates()) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      cachedClampPath = candidate;
      return candidate;
    } catch {
      // try next candidate
    }
  }

  // Fall back to `clamp` on PATH.
  const pathDirs = (process.env.PATH ?? '').split(path.delimiter);
  for (const dir of pathDirs) {
    const candidate = path.join(dir, 'clamp');
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      cachedClampPath = candidate;
      return candidate;
    } catch {
      // try next dir
    }
  }

  cachedClampPath = null;
  return null;
}

export interface ClampResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/** Run Clamp with the given arguments and capture its output. */
export async function runClamp(args: string[]): Promise<ClampResult> {
  const clamp = resolveClamp();
  if (!clamp) {
    return {
      ok: false,
      stdout: '',
      stderr:
        'clamp not found. Set LAZY_CLAMP_BIN, clone https://github.com/wsagency/claude-move-project to ~/github/cloned, or install clamp on your PATH.',
    };
  }
  try {
    const { stdout, stderr } = await execFileAsync(clamp, args, {
      maxBuffer: 10 * 1024 * 1024,
      env: process.env,
    });
    return { ok: true, stdout, stderr };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, stdout: e.stdout ?? '', stderr: e.stderr || (e.message ?? 'clamp failed') };
  }
}

export interface ClampProject {
  /** Absolute project path, or the orphan label Clamp prints. */
  path: string;
  exists: boolean;
  sessions: number;
  projectSizeKb: number;
  sessionSizeKb: number;
  /** Unix timestamp (seconds) of the newest session file, 0 if unknown. */
  lastActivity: number;
  /** True when Clamp reported an orphaned session folder with no known path. */
  orphaned: boolean;
  /** Encoded folder name under ~/.claude/projects. */
  encoded: string;
}

const ORPHAN_PATTERN = /^\(orphaned session: (.+)\)$/;

/** List projects via `clamp --list --json`. */
export async function listProjects(): Promise<ClampProject[]> {
  const result = await runClamp(['--list', '--json']);
  if (!result.ok) {
    throw new Error(result.stderr || 'clamp --list failed');
  }
  const raw = JSON.parse(result.stdout) as Array<{
    path: string;
    exists: boolean;
    sessions: number;
    project_size_kb: number;
    session_size_kb: number;
    last_activity: string;
  }>;

  return raw.map((entry) => {
    const orphanMatch = ORPHAN_PATTERN.exec(entry.path);
    // clamp emits "YYYY-MM-DD HH:MM:SS" (local time) or "unknown".
    const parsed = Date.parse(entry.last_activity.replace(' ', 'T'));
    const lastActivity = Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
    return {
      path: entry.path,
      exists: entry.exists,
      sessions: entry.sessions,
      projectSizeKb: entry.project_size_kb,
      sessionSizeKb: entry.session_size_kb,
      lastActivity,
      orphaned: orphanMatch !== null,
      encoded: orphanMatch ? orphanMatch[1] : entry.path.replaceAll('/', '-'),
    };
  });
}

export function verify(): Promise<ClampResult> {
  return runClamp(['--verify']);
}

export function prune(dryRun: boolean): Promise<ClampResult> {
  const args = ['--prune', '--force'];
  if (dryRun) args.push('--dry-run');
  return runClamp(args);
}

export function projectInfo(projectPath: string): Promise<ClampResult> {
  return runClamp(['--info', projectPath]);
}
