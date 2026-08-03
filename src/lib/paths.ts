import os from 'node:os';
import path from 'node:path';

/**
 * Root of Claude Code's data directory.
 *
 * Resolution order:
 * 1. LAZY_CLAUDE_CLAUDE_DIR (test override, never touches real data)
 * 2. CLAUDE_CONFIG_DIR (respected by Claude Code itself)
 * 3. ~/.claude
 */
export function claudeDir(): string {
  return (
    process.env.LAZY_CLAUDE_CLAUDE_DIR ??
    process.env.CLAUDE_CONFIG_DIR ??
    path.join(os.homedir(), '.claude')
  );
}

/** Session storage: one folder per project, one JSONL file per session. */
export function projectsDir(): string {
  return path.join(claudeDir(), 'projects');
}

/** Claude Code's history index with one record per session start. */
export function historyFile(): string {
  return path.join(claudeDir(), 'history.jsonl');
}

/**
 * Where archived sessions live. Kept outside `projects/` so Claude Code
 * never picks archived files up as live sessions.
 */
export function archiveDir(): string {
  return path.join(claudeDir(), 'lazy-claude', 'archive');
}

/**
 * Claude Code's project path encoding: every character outside [a-zA-Z0-9]
 * becomes "-". This covers "/" on POSIX and both "\" and ":" on Windows,
 * as well as dots (verified against real data: /home/user/.claude-mem maps
 * to -home-user--claude-mem). The encoding is lossy, so matching always
 * goes from a known path to its encoded form, never the reverse.
 */
export function encodeProjectPath(projectPath: string): string {
  return projectPath.replace(/[^a-zA-Z0-9]/g, '-');
}
