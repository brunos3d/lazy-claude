#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { runCommand } from './cli/commands.js';
import { LauncherService } from './services/LauncherService.js';
import { WorkspaceResolver } from './services/WorkspaceResolver.js';
import { App } from './ui/App.js';

/** Window title while the TUI owns the terminal. */
const APP_TITLE = 'Lazy Claude';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

const USAGE = `lazy-claude ${version}: find, resume and manage Claude Code sessions

Usage:
  lazy-claude                          Open the TUI
  lazy-claude .                        Open the TUI on the current workspace
  lazy-claude <path>                   Open the TUI on a specific project
                                       (short alias: lzc)

  lazy-claude list [--json]            List all projects
  lazy-claude sessions [archived]      List all sessions with titles
  lazy-claude show <session-id>        Session stats, timeline and preview
  lazy-claude search <query>           Search sessions by title, id or path
  lazy-claude info [path] [--json]     Project details (defaults to cwd)
  lazy-claude doctor                   Environment summary
  lazy-claude verify                   Health check

  lazy-claude move <src> <dest>        Move a project and migrate references
  lazy-claude move --here <src>        Move a project into the current dir
  lazy-claude repair                   Scan and relink broken references
  lazy-claude repair <new-path>        Relink a moved project by its new path
  lazy-claude repair --from A --to B   Relink explicitly
  lazy-claude prune                    Remove orphaned session folders
  lazy-claude remove <path>            Delete a project and all session data

  lazy-claude pack <path> [archive]    Pack project + sessions to .claudepack
  lazy-claude unpack <archive> <dest>  Restore a .claudepack elsewhere

  lazy-claude backup [create|list|restore <name>|delete <name>]
  lazy-claude session <archive|restore|delete|check> <session-id>

Options:
  -n, --dry-run    Preview without changing anything
  -f, --force      Skip confirmation prompts
  -p, --parents    Create missing parent directories
  --no-backup      Skip the automatic history.jsonl backup
  --json           JSON output (list, sessions, info)

Environment:
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

  // `lazy-claude .` and `lazy-claude <path>` open the TUI on that workspace.
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
    console.error('lazy-claude needs an interactive terminal. Try `lazy-claude list` instead.');
    process.exitCode = 1;
    return;
  }

  // Switch to the alternate screen buffer for a fullscreen feel, and name
  // the window while we own it. Both are entered and undone together: a
  // leftover title outlives the process in every terminal that does not
  // reset it itself, which is most of them.
  //
  // OSC 0 sets the window title. The bracketing CSI 22/23 push and pop the
  // terminal's own title stack, so quitting restores whatever the shell had
  // set rather than blanking it; terminals without the stack ignore both.
  process.stdout.write('\u001B[?1049h');
  process.stdout.write('\u001B[22;0t');
  process.stdout.write(`\u001B]0;${APP_TITLE}\u0007`);
  // Windows consoles take their title from the process rather than from an
  // escape sequence. Elsewhere it is harmless and shows up in ps.
  process.title = APP_TITLE;

  let restored = false;
  const restoreTerminal = () => {
    if (restored) return;
    restored = true;
    process.stdout.write('\u001B[23;0t');
    process.stdout.write('\u001B[?1049l');
  };
  process.on('exit', restoreTerminal);

  const { waitUntilExit } = render(<App initialProject={initialProject} />, { exitOnCtrlC: true });
  await waitUntilExit();

  // Hand over to Claude Code when a session launch was requested. This runs
  // after Ink unmounted and the alternate screen was restored, so the child
  // inherits a clean terminal and Lazy Claude is fully out of the way.
  const plan = LauncherService.takePending();
  if (plan) {
    restoreTerminal();
    console.log(`${plan.shell}\n`);
    const result = spawnSync(plan.command, plan.args, {
      stdio: 'inherit',
      cwd: plan.cwd,
      env: plan.env,
    });
    if (result.error) {
      console.error(`Failed to launch Claude Code: ${result.error.message}`);
      process.exitCode = 1;
      return;
    }
    process.exitCode = result.status ?? 0;
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
