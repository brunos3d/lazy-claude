import fs from 'node:fs';
import path from 'node:path';
import { isDirectory } from '../core/fsx.js';
import { exists } from '../core/fsx.js';
import type { SessionEntry } from './SessionService.js';

/**
 * Launching Claude Code for a session.
 *
 * A launch mode is data, not code: it contributes arguments and
 * environment to an otherwise fixed plan. Adding "resume with a
 * different model", "read-only", or "resume inside tmux" later means
 * adding an entry here, and the UI picks it up without changes.
 */
export interface LaunchMode {
  id: string;
  label: string;
  description: string;
  /** Rendered with a warning treatment and confirmed before running. */
  danger?: boolean;
  /** Arguments inserted before the resume flag. */
  args?: string[];
  /** Extra environment for the child process. */
  env?: Record<string, string>;
  /** Wrap the command, for future tmux or new-terminal modes. */
  wrap?: (command: string, args: string[]) => { command: string; args: string[] };
}

export const LAUNCH_MODES = {
  resume: {
    id: 'resume',
    label: 'Resume session',
    description: 'Open this conversation in Claude Code',
  },
  resumeDangerous: {
    id: 'resumeDangerous',
    label: 'Resume (skip permissions)',
    description: 'Resume without interactive permission prompts',
    danger: true,
    args: ['--dangerously-skip-permissions'],
  },
} satisfies Record<string, LaunchMode>;

export interface LaunchPlan {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Shell equivalent, shown to the user before handing over. */
  shell: string;
  mode: LaunchMode;
  /**
   * Where the interface should land when Claude Code exits and Lazy Claude
   * comes back up. Kept as plain strings rather than the SessionEntry
   * because the session on disk will have changed by then: Claude Code
   * appends to the file while it runs, so only the identity is still valid.
   */
  target: { id: string; file: string; encoded: string };
}

/** Thrown for conditions the user can act on, with a readable reason. */
export class LaunchError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'LaunchError';
  }
}

const CLAUDE_BINARIES =
  process.platform === 'win32' ? ['claude.cmd', 'claude.exe', 'claude'] : ['claude'];

class LauncherServiceImpl {
  private pending: LaunchPlan | null = null;

  /**
   * Locate the Claude Code executable. The override is validated like any
   * other candidate: returning it unchecked would defer the failure to
   * spawn time, after the interface has already exited.
   */
  findClaude(): string | null {
    const override = process.env.LAZY_CLAUDE_CLAUDE_BIN;
    if (override) {
      try {
        fs.accessSync(override, fs.constants.X_OK);
        return override;
      } catch {
        return null;
      }
    }
    const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
    for (const dir of dirs) {
      for (const name of CLAUDE_BINARIES) {
        const candidate = path.join(dir, name);
        try {
          fs.accessSync(candidate, fs.constants.X_OK);
          return candidate;
        } catch {
          // keep looking
        }
      }
    }
    return null;
  }

  /**
   * Validate everything the launch depends on and build the plan.
   * Throws LaunchError with an actionable message when it cannot run.
   */
  async prepare(
    session: SessionEntry,
    projectPath: string | undefined,
    mode: LaunchMode,
  ): Promise<LaunchPlan> {
    const command = this.findClaude();
    if (!command) {
      throw new LaunchError(
        process.env.LAZY_CLAUDE_CLAUDE_BIN
          ? `LAZY_CLAUDE_CLAUDE_BIN is set to "${process.env.LAZY_CLAUDE_CLAUDE_BIN}", which is not an executable file.`
          : 'Claude Code executable not found on PATH.',
        'Install Claude Code, or set LAZY_CLAUDE_CLAUDE_BIN to its full path.',
      );
    }

    if (session.archived) {
      throw new LaunchError(
        'This session is archived, so Claude Code cannot see it.',
        'Restore it first (r in the Sessions panel), then resume.',
      );
    }

    if (!projectPath) {
      throw new LaunchError(
        'This session has no known project directory.',
        'It belongs to an orphaned session folder. Repair the reference first.',
      );
    }

    if (!(await isDirectory(projectPath))) {
      throw new LaunchError(
        `The project directory no longer exists: ${projectPath}`,
        'Move or repair the project first, then resume.',
      );
    }

    if (!(await exists(session.file))) {
      throw new LaunchError(
        'The session file no longer exists.',
        'Refresh with R; it may have been deleted or moved.',
      );
    }

    if (!/^[A-Za-z0-9._-]+$/.test(session.id)) {
      throw new LaunchError(`Unexpected session id: ${session.id}`, 'Refusing to launch.');
    }

    const args = [...(mode.args ?? []), '--resume', session.id];
    const wrapped = mode.wrap ? mode.wrap(command, args) : { command, args };

    return {
      command: wrapped.command,
      args: wrapped.args,
      cwd: projectPath,
      env: { ...process.env, ...(mode.env ?? {}) },
      shell: `cd ${projectPath} && claude ${args.join(' ')}`,
      mode,
      target: { id: session.id, file: session.file, encoded: session.encoded },
    };
  }

  /**
   * Hand-off channel. The UI records the plan and exits; the CLI entry
   * point runs it once Ink has unmounted and the terminal is restored,
   * so Claude Code inherits a clean terminal.
   */
  request(plan: LaunchPlan): void {
    this.pending = plan;
  }

  takePending(): LaunchPlan | null {
    const plan = this.pending;
    this.pending = null;
    return plan;
  }
}

export const LauncherService = new LauncherServiceImpl();
