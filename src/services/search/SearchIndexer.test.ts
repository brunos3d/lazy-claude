import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { encodeProjectPath } from '../../core/paths.js';
import type { Project } from '../DiscoveryService.js';
import { SessionMetadataService } from '../SessionMetadataService.js';
import { listAllSessions } from '../SessionService.js';
import { SearchIndexer } from './SearchIndexer.js';

/** A throwaway ~/.claude with one project holding two sessions. */
async function fixture(): Promise<{ root: string; projectPath: string; encoded: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lazy-claude-index-'));
  const projectPath = path.join(root, 'workspace', 'demo');
  const encoded = encodeProjectPath(projectPath);
  const dir = path.join(root, 'projects', encoded);
  await fs.mkdir(dir, { recursive: true });
  await fs.mkdir(projectPath, { recursive: true });

  const titled = [
    JSON.stringify({ type: 'user', cwd: projectPath, gitBranch: 'main', timestamp: '2026-01-01T00:00:00Z', message: { content: 'hello' } }),
    JSON.stringify({ type: 'ai-title', aiTitle: 'Build the command palette' }),
  ].join('\n');
  const untitled = JSON.stringify({
    type: 'user',
    cwd: projectPath,
    timestamp: '2026-01-02T00:00:00Z',
    message: { content: 'Fix the migration issue' },
  });

  await fs.writeFile(path.join(dir, 'aaaaaaaa-0000-0000-0000-000000000001.jsonl'), `${titled}\n`);
  await fs.writeFile(path.join(dir, 'bbbbbbbb-0000-0000-0000-000000000002.jsonl'), `${untitled}\n`);
  return { root, projectPath, encoded };
}

function project(projectPath: string, encoded: string): Project {
  return {
    path: projectPath,
    exists: true,
    sessions: 2,
    sessionSizeKb: 1,
    lastActivity: 1767225600,
    orphaned: false,
    encoded,
  };
}

test('warm builds a ready index with sessions and titles', async () => {
  const { root, projectPath, encoded } = await fixture();
  process.env.LAZY_CLAUDE_CLAUDE_DIR = root;
  try {
    SearchIndexer.invalidate();
    await SearchIndexer.warm([project(projectPath, encoded)]);
    const index = SearchIndexer.snapshot();

    assert.equal(index.status, 'ready');
    assert.equal(index.sessions.length, 2);
    assert.equal(index.projects.length, 1);
    assert.equal(index.projectLabels.get(encoded), projectPath);

    const titled = index.sessions.find((s) => s.id.startsWith('aaaaaaaa'));
    assert.ok(titled);
    assert.equal(index.metadata.get(titled.file)?.title, 'Build the command palette');
  } finally {
    delete process.env.LAZY_CLAUDE_CLAUDE_DIR;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('subscribers see progress and are released on unsubscribe', async () => {
  const { root, projectPath, encoded } = await fixture();
  process.env.LAZY_CLAUDE_CLAUDE_DIR = root;
  try {
    SearchIndexer.invalidate();
    const seen: string[] = [];
    const unsubscribe = SearchIndexer.subscribe((index) => seen.push(index.status));
    await SearchIndexer.warm([project(projectPath, encoded)]);
    unsubscribe();

    assert.ok(seen.includes('building'), 'expected a building publish');
    assert.equal(seen.at(-1), 'ready');

    const before = seen.length;
    SearchIndexer.invalidate();
    assert.equal(seen.length, before, 'unsubscribed listener still fired');
  } finally {
    delete process.env.LAZY_CLAUDE_CLAUDE_DIR;
    await fs.rm(root, { recursive: true, force: true });
  }
});

/**
 * The generation stamp alone only hides a build's results; the reads keep
 * running and hold the event loop open after the TUI unmounts. The signal
 * has to reach the batch loop, which is what this pins down.
 */
test('an aborted signal stops the metadata pass before it parses anything', async () => {
  const { root } = await fixture();
  process.env.LAZY_CLAUDE_CLAUDE_DIR = root;
  try {
    const sessions = await listAllSessions();
    assert.equal(sessions.length, 2, 'fixture should expose two uncached sessions');

    const metadata = await SessionMetadataService.getMany(sessions, undefined, AbortSignal.abort());

    for (const session of sessions) {
      assert.equal(metadata.has(session.file), false, `parsed ${session.id} despite the abort`);
    }
  } finally {
    delete process.env.LAZY_CLAUDE_CLAUDE_DIR;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('invalidate resets the snapshot to empty', async () => {
  const { root, projectPath, encoded } = await fixture();
  process.env.LAZY_CLAUDE_CLAUDE_DIR = root;
  try {
    SearchIndexer.invalidate();
    await SearchIndexer.warm([project(projectPath, encoded)]);
    assert.equal(SearchIndexer.snapshot().status, 'ready');

    SearchIndexer.invalidate();
    const index = SearchIndexer.snapshot();
    assert.equal(index.status, 'empty');
    assert.equal(index.sessions.length, 0);
    assert.equal(index.projects.length, 0);
  } finally {
    delete process.env.LAZY_CLAUDE_CLAUDE_DIR;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('the index orders projects by recency, whatever order the seed arrived in', async () => {
  const { root, projectPath, encoded } = await fixture();
  process.env.LAZY_CLAUDE_CLAUDE_DIR = root;
  SearchIndexer.invalidate();

  // Nothing renders this list, but FilterService keeps caller order inside a
  // match tier, so it decides which of two equally good project hits the
  // palette shows first.
  const older = { ...project(projectPath, encoded), path: '/older', encoded: '-older', lastActivity: 1 };
  const newer = { ...project(projectPath, encoded), path: '/newer', encoded: '-newer', lastActivity: 9 };
  await SearchIndexer.warm([older, newer]);

  assert.deepEqual(
    SearchIndexer.snapshot().projects.map((entry) => entry.path),
    ['/newer', '/older'],
  );
});
