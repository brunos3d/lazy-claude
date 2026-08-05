#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { runCommand } from './cli/commands.js';
import { LauncherService, type LaunchPlan } from './services/LauncherService.js';
import { WorkspaceResolver } from './services/WorkspaceResolver.js';
import { App } from './ui/App.js';

/** Window title while the TUI owns the terminal. */
const APP_TITLE = 'Lazy Claude';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

const USAGE = `lazyclaude ${version}: find, resume and manage Claude Code sessions

Usage:
  lazyclaude                          Open the TUI
  lazyclaude .                        Open the TUI on the current workspace
  lazyclaude <path>                   Open the TUI on a specific project
                                      (aliases: lazy-claude, lazy-claude-tui, lzc)

  lazyclaude list [--json]            List all projects
  lazyclaude sessions [archived]      List all sessions with titles
  lazyclaude show <session-id>        Session stats, timeline and preview
  lazyclaude search <query>           Search sessions by title, id or path
  lazyclaude info [path] [--json]     Project details (defaults to cwd)
  lazyclaude stats [--json]           Workspace storage and counts
  lazyclaude doctor                   Environment summary
  lazyclaude verify                   Health check

  lazyclaude move <src> <dest>        Move a project and migrate references
  lazyclaude move --here <src>        Move a project into the current dir
  lazyclaude repair                   Scan and relink broken references
  lazyclaude repair <new-path>        Relink a moved project by its new path
  lazyclaude repair --from A --to B   Relink explicitly
  lazyclaude prune                    Remove orphaned session folders
  lazyclaude remove <path>            Delete a project and all session data

  lazyclaude pack <path> [archive]    Pack project + sessions to .claudepack
  lazyclaude unpack <archive> <dest>  Restore a .claudepack elsewhere

  lazyclaude backup [create|list|restore <name>|delete <name>]
  lazyclaude session <archive|restore|delete|check> <session-id>

Options:
  -n, --dry-run    Preview without changing anything
  -f, --force      Skip confirmation prompts
  -p, --parents    Create missing parent directories
  --no-backup      Skip the automatic history.jsonl backup
  --json           JSON output (list, sessions, info, stats)

Environment:
  LAZY_CLAUDE_NO_RETURN   Exit on handover instead of returning from Claude Code
  LAZY_CLAUDE_CLAUDE_BIN  Path to the claude executable, when not on PATH
  LAZY_CLAUDE_CLAUDE_DIR  Override the Claude data directory
  CLAUDE_CONFIG_DIR       Respected when set (same variable Claude Code uses)
                          Default: ~/.claude`;

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--version') || args.includes('-V')) {
    console.log(version);
    return;
  }
  if (args.includes('--help') || args.includes('-h') || args[0] === 'help') {
    console.log(USAGE);
    return;
  }

  const command = args[0];

  // `lazyclaude .` and `lazyclaude <path>` open the TUI on that workspace.
  const workspaceArg = WorkspaceResolver.looksLikePath(command) ? command : undefined;

  if (command && !workspaceArg) {
    const code = await runCommand(command, args.slice(1));
    if (code === -1) {
      console.error(`Unknown command: ${command}\n`);
      console.error(USAGE);
      process.exitCode = 1;
    } else {
      process.exitCode = code;
    }
    return;
  }

  let initialProject: string | undefined;
  if (workspaceArg) {
    const target = path.resolve(expandHome(workspaceArg));
    const match = await WorkspaceResolver.resolve(target);
    if (match) initialProject = match.project.path;
    else {
      console.error(
        `No Claude Code sessions found for ${target}. Opening the full project list instead.`,
      );
    }
  }

  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    console.error('lazyclaude needs an interactive terminal. Try `lazyclaude list` instead.');
    process.exitCode = 1;
    return;
  }

  /**
   * Alternate screen and window title.
   *
   * Entered and left as a pair, because a leftover title outlives the
   * process in every terminal that does not reset it itself, which is most
   * of them. Both are re-entrant now: a resume leaves fullscreen to hand the
   * terminal to Claude Code and enters it again on the way back, and the CSI
   * 22/23 title stack has to be pushed and popped the same number of times
   * or the shell's own title never comes back.
   *
   * OSC 0 sets the title. Terminals without the title stack ignore 22/23.
   */
  let fullscreen = false;
  const enterFullscreen = () => {
    if (fullscreen) return;
    fullscreen = true;
    process.stdout.write('\u001B[?1049h');
    process.stdout.write('\u001B[22;0t');
    process.stdout.write(`\u001B]0;${APP_TITLE}\u0007`);
    // Windows consoles take their title from the process rather than from
    // an escape sequence. Elsewhere it is harmless and shows up in ps.
    process.title = APP_TITLE;
  };
  const leaveFullscreen = () => {
    if (!fullscreen) return;
    fullscreen = false;
    process.stdout.write('\u001B[23;0t');
    process.stdout.write('\u001B[?1049l');
  };
  process.on('exit', leaveFullscreen);

  /**
   * Resuming is a round trip, not an exit.
   *
   * Claude Code runs in place of the interface rather than underneath it, so
   * this unmounts Ink, hands over the real terminal, and mounts again once
   * the child exits. Ink is fully torn down at that point, which is what
   * makes a second `render` safe: raw mode, the stdin listeners and the
   * alternate screen belong to the terminal between iterations rather than
   * to a suspended interface.
   *
   * Set LAZY_CLAUDE_NO_RETURN to keep the old behaviour and exit into
   * whatever Claude Code leaves behind.
   */
  let target: LaunchPlan['target'] | undefined;
  let status: string | undefined;

  for (;;) {
    enterFullscreen();
    const { waitUntilExit } = render(
      <App initialProject={initialProject} initialTarget={target} initialStatus={status} />,
      { exitOnCtrlC: true },
    );
    await waitUntilExit();

    const plan = LauncherService.takePending();
    if (!plan) return;

    // Ink has unmounted and the alternate screen is restored, so the child
    // inherits a clean terminal and Lazy Claude is fully out of the way.
    leaveFullscreen();
    console.log(`${plan.shell}\n`);
    const result = spawnSync(plan.command, plan.args, {
      stdio: 'inherit',
      cwd: plan.cwd,
      env: plan.env,
    });

    // A spawn failure means Claude Code never ran, so there is nothing to
    // come back from. It also leaves its message on the real screen, which
    // re-entering the alternate screen would swallow.
    if (result.error) {
      console.error(`Failed to launch Claude Code: ${result.error.message}`);
      process.exitCode = 1;
      return;
    }

    if (process.env.LAZY_CLAUDE_NO_RETURN) {
      process.exitCode = result.status ?? 0;
      return;
    }

    // Land back on the session that was just being worked on. The path
    // argument has done its job by now; honouring it again would drag the
    // selection back to wherever the process started.
    initialProject = undefined;
    target = plan.target;
    // A clean exit needs no announcement. A crash or a non-zero exit does,
    // and the alternate screen is about to hide the child's own output.
    status = result.status
      ? `Claude Code exited with code ${result.status}`
      : result.signal
        ? `Claude Code was terminated by ${result.signal}`
        : undefined;
  }
}

function expandHome(input: string): string {
  if (input === '~') return os.homedir();
  if (input.startsWith('~/') || input.startsWith('~\\')) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});
