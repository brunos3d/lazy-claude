#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { createRequire } from 'node:module';
import { listProjects, resolveClamp, runClamp } from './lib/clamp.js';
import { App } from './ui/App.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

const USAGE = `lazy-clamp ${version} — LazyGit-style TUI for Claude Code sessions

Usage:
  lazy-clamp            Open the TUI (also available as lzclamp)
  lazy-clamp list       Print projects as JSON (via clamp --list --json)
  lazy-clamp doctor     Show which clamp binary is used and basic checks
  lazy-clamp --help     Show this help
  lazy-clamp --version  Show version

Environment:
  LAZY_CLAMP_BIN         Path to the clamp script to use
  LAZY_CLAMP_CLAUDE_DIR  Claude data dir (default: ~/.claude)

Built on clamp: https://github.com/wsagency/claude-move-project`;

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--version') || args.includes('-V')) {
    console.log(version);
    return;
  }
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    return;
  }

  const command = args[0];

  if (command === 'list') {
    const projects = await listProjects();
    console.log(JSON.stringify(projects, null, 2));
    return;
  }

  if (command === 'doctor') {
    const clamp = resolveClamp();
    console.log(`lazy-clamp ${version}`);
    console.log(`clamp binary: ${clamp ?? 'NOT FOUND'}`);
    if (clamp) {
      const result = await runClamp(['--version']);
      console.log(`clamp version: ${(result.stdout || result.stderr).trim()}`);
    } else {
      console.log(
        'Set LAZY_CLAMP_BIN or install clamp (https://github.com/wsagency/claude-move-project).',
      );
      process.exitCode = 1;
    }
    return;
  }

  if (command) {
    console.error(`Unknown command: ${command}\n`);
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    console.error('lazy-clamp needs an interactive terminal. Try `lazy-clamp list` instead.');
    process.exitCode = 1;
    return;
  }

  // Switch to the alternate screen buffer for a fullscreen, lazygit-like feel.
  process.stdout.write('\u001B[?1049h');
  const restoreScreen = () => process.stdout.write('\u001B[?1049l');
  process.on('exit', restoreScreen);

  const { waitUntilExit } = render(<App />, { exitOnCtrlC: true });
  await waitUntilExit();
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});
