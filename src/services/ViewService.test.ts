import test from 'node:test';
import assert from 'node:assert/strict';
import { PROJECT_SORTS, SESSION_SORTS, ViewService } from './ViewService.js';
import type { Project } from './DiscoveryService.js';
import type { SessionMetadata } from './SessionMetadataService.js';
import type { SessionEntry } from './SessionService.js';

function session(id: string, sizeBytes: number, modified: string): SessionEntry {
  return {
    id,
    encoded: '-home-user-app',
    file: `/sessions/${id}.jsonl`,
    sizeBytes,
    modifiedAt: new Date(modified),
    archived: false,
  };
}

function project(overrides: Partial<Project> & { path: string }): Project {
  return {
    exists: true,
    sessions: 1,
    sessionSizeKb: 10,
    lastActivity: 1000,
    orphaned: false,
    encoded: overrides.path.replace(/[^a-zA-Z0-9]/g, '-'),
    ...overrides,
  };
}

const titles = (map: Record<string, string>): Map<string, SessionMetadata> =>
  new Map(
    Object.entries(map).map(([file, title]) => [file, { title, titleSource: 'ai-title' as const }]),
  );

const ids = (list: SessionEntry[]) => list.map((entry) => entry.id);
const paths = (list: Project[]) => list.map((entry) => entry.path);

const A = session('a', 300, '2024-01-03T00:00:00Z');
const B = session('b', 100, '2024-01-01T00:00:00Z');
const C = session('c', 200, '2024-01-02T00:00:00Z');

test('sessions sort by modified date in both directions', () => {
  const meta = new Map<string, SessionMetadata>();
  assert.deepEqual(
    ids(ViewService.sortSessions([B, A, C], meta, { field: 'modified', direction: 'desc' })),
    ['a', 'c', 'b'],
  );
  assert.deepEqual(
    ids(ViewService.sortSessions([B, A, C], meta, { field: 'modified', direction: 'asc' })),
    ['b', 'c', 'a'],
  );
});

test('sessions sort by size in both directions', () => {
  const meta = new Map<string, SessionMetadata>();
  assert.deepEqual(ids(ViewService.sortSessions([B, A, C], meta, { field: 'size', direction: 'desc' })), [
    'a',
    'c',
    'b',
  ]);
  assert.deepEqual(ids(ViewService.sortSessions([B, A, C], meta, { field: 'size', direction: 'asc' })), [
    'b',
    'c',
    'a',
  ]);
});

test('title sort uses metadata titles, case insensitively', () => {
  const meta = titles({
    '/sessions/a.jsonl': 'zebra',
    '/sessions/b.jsonl': 'Apple',
    '/sessions/c.jsonl': 'mango',
  });
  assert.deepEqual(ids(ViewService.sortSessions([A, B, C], meta, { field: 'title', direction: 'asc' })), [
    'b',
    'c',
    'a',
  ]);
  assert.deepEqual(ids(ViewService.sortSessions([A, B, C], meta, { field: 'title', direction: 'desc' })), [
    'a',
    'c',
    'b',
  ]);
});

test('title sort falls back to the session id, which is what the row shows', () => {
  // Metadata arrives after the list, so the sort has to work without it.
  const untitled = session('zzz', 1, '2024-01-01T00:00:00Z');
  const meta = titles({ '/sessions/a.jsonl': 'apple' });
  const sorted = ViewService.sortSessions([untitled, A], meta, {
    field: 'title',
    direction: 'asc',
  });
  assert.deepEqual(ids(sorted), ['a', 'zzz']);
});

test('sorting never mutates the input list', () => {
  const input = [B, A, C];
  ViewService.sortSessions(input, new Map(), { field: 'size', direction: 'desc' });
  assert.deepEqual(ids(input), ['b', 'a', 'c']);
});

test('ties keep the caller order', () => {
  const first = session('first', 100, '2024-01-01T00:00:00Z');
  const second = session('second', 100, '2024-01-01T00:00:00Z');
  const sorted = ViewService.sortSessions([first, second], new Map(), {
    field: 'size',
    direction: 'desc',
  });
  assert.deepEqual(ids(sorted), ['first', 'second']);
});

const P1 = project({ path: '/home/user/beta', lastActivity: 300, sessions: 1, sessionSizeKb: 50 });
const P2 = project({ path: '/home/user/alpha', lastActivity: 100, sessions: 9, sessionSizeKb: 10 });
const P3 = project({ path: '/home/user/Gamma', lastActivity: 200, sessions: 5, sessionSizeKb: 90 });

test('projects sort by activity, session count, size and name', () => {
  assert.deepEqual(
    paths(ViewService.sortProjects([P2, P1, P3], { field: 'activity', direction: 'desc' })),
    ['/home/user/beta', '/home/user/Gamma', '/home/user/alpha'],
  );
  assert.deepEqual(
    paths(ViewService.sortProjects([P2, P1, P3], { field: 'activity', direction: 'asc' })),
    ['/home/user/alpha', '/home/user/Gamma', '/home/user/beta'],
  );
  assert.deepEqual(
    paths(ViewService.sortProjects([P1, P2, P3], { field: 'sessions', direction: 'desc' })),
    ['/home/user/alpha', '/home/user/Gamma', '/home/user/beta'],
  );
  assert.deepEqual(
    paths(ViewService.sortProjects([P1, P2, P3], { field: 'size', direction: 'desc' })),
    ['/home/user/Gamma', '/home/user/beta', '/home/user/alpha'],
  );
  // Case insensitive, or Gamma would sort ahead of every lowercase name.
  assert.deepEqual(paths(ViewService.sortProjects([P1, P2, P3], { field: 'name', direction: 'asc' })), [
    '/home/user/alpha',
    '/home/user/beta',
    '/home/user/Gamma',
  ]);
});

test('orphaned projects sort by their encoded folder, which is what they display', () => {
  const orphan = project({ path: '-aaa-orphan', orphaned: true, encoded: '-aaa-orphan' });
  const sorted = ViewService.sortProjects([P1, orphan], { field: 'name', direction: 'asc' });
  assert.equal(sorted[0].path, '-aaa-orphan');
});

test('project filters select exactly their predicate', () => {
  const missing = project({ path: '/gone', exists: false });
  const orphan = project({ path: '-orphan', orphaned: true, exists: false });
  const empty = project({ path: '/empty', sessions: 0 });
  const all = [P1, missing, orphan, empty];

  assert.deepEqual(paths(ViewService.filterProjects(all, 'missing')), ['/gone']);
  assert.deepEqual(paths(ViewService.filterProjects(all, 'orphaned')), ['-orphan']);
  assert.deepEqual(paths(ViewService.filterProjects(all, 'empty')), ['/empty']);
  assert.equal(ViewService.filterProjects(all, 'none').length, 4);
});

test('an orphan is never reported as a missing project', () => {
  // Both have exists: false, but repair only applies to a known path.
  const orphan = project({ path: '-orphan', orphaned: true, exists: false });
  assert.deepEqual(ViewService.filterProjects([orphan], 'missing'), []);
});

test('every named sort resolves back to its own option', () => {
  for (const option of SESSION_SORTS) {
    assert.equal(ViewService.sessionSortOption(option.sort).id, option.id);
  }
  for (const option of PROJECT_SORTS) {
    assert.equal(ViewService.projectSortOption(option.sort).id, option.id);
  }
});

test('named sorts are unique, so the indicator is never ambiguous', () => {
  const sessionKeys = SESSION_SORTS.map((o) => `${o.sort.field}:${o.sort.direction}`);
  const projectKeys = PROJECT_SORTS.map((o) => `${o.sort.field}:${o.sort.direction}`);
  assert.equal(new Set(sessionKeys).size, sessionKeys.length);
  assert.equal(new Set(projectKeys).size, projectKeys.length);
});
