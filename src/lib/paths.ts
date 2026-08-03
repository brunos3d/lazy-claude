import os from 'node:os';
import path from 'node:path';

/**
 * Root of Claude Code's data directory. Overridable for tests via
 * LAZY_CLAMP_CLAUDE_DIR so nothing ever touches real session data by accident.
 */
export function claudeDir(): string {
  return process.env.LAZY_CLAMP_CLAUDE_DIR ?? path.join(os.homedir(), '.claude');
}

export function projectsDir(): string {
  return path.join(claudeDir(), 'projects');
}

/**
 * Where archived sessions live. Kept outside `projects/` so Claude Code and
 * Clamp never pick archived files up as live sessions.
 */
export function archiveDir(): string {
  return path.join(claudeDir(), 'lazy-clamp', 'archive');
}

/**
 * Claude's path encoding, mirrored from Clamp's encode_path():
 * every "/" becomes "-", e.g. /home/me/app -> -home-me-app.
 */
export function encodePath(projectPath: string): string {
  return projectPath.replaceAll('/', '-');
}
