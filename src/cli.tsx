#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { createRequire } from 'node:module';
import { claudeDir, projectsDir } from './lib/paths.js';
import { discoverProjects } from './lib/projects.js';
import { App } from './ui/App.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

const USAGE = `lazy-claude ${version}: a LazyGit-style TUI for Claude Code sessions

Usage:
  lazy-claude           Open the TUI (also available as lzc)
  lazy-claude list      Print discovered projects as JSON
  lazy-claude doctor    Show data directory and discovery stats
  lazy-claude --help    Show this help
  lazy-claude --version Show version

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
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    return;
  }

  const command = args[0];

  if (command === 'list') {
    const projects = await discoverProjects();
    projects.sort((a, b) => b.lastActivity - a.lastActivity);
    console.log(JSON.stringify(projects, null, 2));
    return;
  }

  if (command === 'doctor') {
    console.log(`lazy-claude ${version}`);
    console.log(`claude dir: ${claudeDir()}`);
    console.log(`projects dir: ${projectsDir()}`);
    const projects = await discoverProjects();
    const sessions = projects.reduce((sum, p) => sum + p.sessions, 0);
    const orphans = projects.filter((p) => p.orphaned).length;
    console.log(`projects: ${projects.length} (${orphans} orphaned)`);
    console.log(`sessions: ${sessions}`);
    return;
  }

  if (command) {
    console.error(`Unknown command: ${command}\n`);
    console.error(USAGE);
    process.exitCode = 1;
    return;
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

  const { waitUntilExit } = render(<App />, { exitOnCtrlC: true });
  await waitUntilExit();
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});
