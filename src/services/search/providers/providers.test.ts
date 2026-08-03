import test from 'node:test';
import assert from 'node:assert/strict';
import type { Project } from '../../DiscoveryService.js';
import type { SessionEntry } from '../../SessionService.js';
import type { SessionMetadata } from '../../SessionMetadataService.js';
import type { SearchContext, WorkspaceIndex } from '../types.js';
import { ConversationProvider } from './ConversationProvider.js';
import { ProjectProvider } from './ProjectProvider.js';
import { SessionProvider } from './SessionProvider.js';

const HOME = '/home/dev';

const project = (path: string, encoded: string, sessions: number): Project => ({
  path,
  exists: true,
  sessions,
  sessionSizeKb: 10,
  lastActivity: 1767225600,
  orphaned: false,
  encoded,
});

const session = (id: string, encoded: string, archived = false): SessionEntry => ({
  id,
  encoded,
  file: `/sessions/${encoded}/${id}.jsonl`,
  sizeBytes: 100,
  modifiedAt: new Date('2026-01-01T00:00:00Z'),
  archived,
});

const meta = (title: string): SessionMetadata => ({ title, titleSource: 'ai-title' });

function makeIndex(): WorkspaceIndex {
  const lazy = project(`${HOME}/github/lazy-claude-tui`, '-home-dev-github-lazy-claude-tui', 4);
  const vortex = project(`${HOME}/github/vortex-platform`, '-home-dev-github-vortex-platform', 2);
  const sessions = [
    session('s1', lazy.encoded),
    session('s2', vortex.encoded),
    session('s3', lazy.encoded, true),
  ];
  return {
    projects: [lazy, vortex],
    sessions,
    metadata: new Map([
      [sessions[0].file, meta('Build Lazy Claude TUI')],
      [sessions[1].file, meta('Implement billing architecture')],
      [sessions[2].file, meta('Add command palette')],
    ]),
    projectLabels: new Map([
      [lazy.encoded, '~/github/lazy-claude-tui'],
      [vortex.encoded, '~/github/vortex-platform'],
    ]),
    home: HOME,
    status: 'ready',
    done: 3,
    total: 3,
  };
}

const context = (index: WorkspaceIndex): SearchContext => ({
  index,
  signal: new AbortController().signal,
});

test('ProjectProvider returns shortened titles, full paths, and project targets', async () => {
  const index = makeIndex();
  const hits = await ProjectProvider.search('vortex', context(index));

  assert.equal(hits.length, 1);
  assert.equal(hits[0].kind, 'project');
  assert.equal(hits[0].title, '~/github/vortex-platform');
  assert.equal(hits[0].subtitle, `${HOME}/github/vortex-platform`);
  assert.deepEqual(hits[0].target, {
    kind: 'project',
    encoded: '-home-dev-github-vortex-platform',
  });
  assert.match(hits[0].meta ?? '', /2 sessions/);
});

test('ProjectProvider is disabled on an empty index', () => {
  const index = makeIndex();
  assert.equal(ProjectProvider.enabled(context(index)), true);
  assert.equal(ProjectProvider.enabled(context({ ...index, projects: [] })), false);
});

test('SessionProvider matches titles and carries the owning project as subtitle', async () => {
  const index = makeIndex();
  const hits = await SessionProvider.search('billing', context(index));

  assert.equal(hits.length, 1);
  assert.equal(hits[0].kind, 'session');
  assert.equal(hits[0].title, 'Implement billing architecture');
  assert.equal(hits[0].subtitle, '~/github/vortex-platform');
  assert.deepEqual(hits[0].target, {
    kind: 'session',
    encoded: '-home-dev-github-vortex-platform',
    file: '/sessions/-home-dev-github-vortex-platform/s2.jsonl',
    archived: false,
  });
});

test('SessionProvider marks archived sessions and targets them as archived', async () => {
  const index = makeIndex();
  const hits = await SessionProvider.search('command palette', context(index));

  assert.equal(hits.length, 1);
  assert.match(hits[0].meta ?? '', /archived/);
  assert.equal(
    hits[0].target.kind === 'session' ? hits[0].target.archived : null,
    true,
  );
});

test('SessionProvider does not match on the project path', async () => {
  const index = makeIndex();
  // "vortex" names a project, never a session title. Matching sessions on
  // their project path would return every session that project owns.
  const hits = await SessionProvider.search('vortex', context(index));
  assert.equal(hits.length, 0);
});

test('ConversationProvider is registered but disabled and returns nothing', async () => {
  const index = makeIndex();
  assert.equal(ConversationProvider.kind, 'message');
  assert.equal(ConversationProvider.title, 'Messages');
  assert.equal(ConversationProvider.enabled(context(index)), false);
  assert.deepEqual(await ConversationProvider.search('anything', context(index)), []);
});
