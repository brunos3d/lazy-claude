#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { runCommand } from './cli/commands.js';
import { WorkspaceResolver } from './services/WorkspaceResolver.js';
import { App } from './ui/App.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

const USAGE = `lazy-claude ${version}: a LazyGit-style manager for Claude Code sessions

Usage:
  lazy-claude                          Open the TUI
  lazy-claude .                        Open the TUI on the current workspace
  lazy-claude <path>                   Open the TUI on a specific project
                                       (aliases: lazyclaude, lzc)

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

  // Switch to the alternate screen buffer for a fullscreen feel.
  process.stdout.write('\u001B[?1049h');
  const restoreScreen = () => process.stdout.write('\u001B[?1049l');
  process.on('exit', restoreScreen);

  const { waitUntilExit } = render(<App initialProject={initialProject} />, { exitOnCtrlC: true });
  await waitUntilExit();
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
