import test from 'node:test';
import assert from 'node:assert/strict';
import { StatsService } from './StatsService.js';
import type { Project } from './DiscoveryService.js';
import type { SessionEntry } from './SessionService.js';

function project(path: string, overrides: Partial<Project> = {}): Project {
  return {
    path,
    exists: true,
    sessions: 1,
    sessionSizeKb: 1,
    lastActivity: 0,
    orphaned: false,
    encoded: path.replace(/[^a-zA-Z0-9]/g, '-'),
    ...overrides,
  };
}

function session(
  id: string,
  encoded: string,
  sizeBytes: number,
  modified: string,
  archived = false,
): SessionEntry {
  return {
    id,
    encoded,
    file: `/f/${id}.jsonl`,
    sizeBytes,
    modifiedAt: new Date(modified),
    archived,
  };
}

const APP = '-home-user-app';
const LIB = '-home-user-lib';

const projects = [
  project('/home/user/app', { encoded: APP }),
  project('/home/user/lib', { encoded: LIB }),
  project('/home/user/gone', { exists: false }),
  project('-weird-folder', { orphaned: true, exists: false, encoded: '-weird-folder' }),
  project('/home/user/blank', { sessions: 0 }),
];

const sessions = [
  session('one', APP, 5000, '2024-03-01T00:00:00Z'),
  session('two', APP, 3000, '2024-01-01T00:00:00Z'),
  session('three', LIB, 1000, '2024-02-01T00:00:00Z'),
  session('four', LIB, 2000, '2024-02-02T00:00:00Z', true),
];

const stats = () => StatsService.compute({ projects, sessions, home: '/home/user' });

test('project counts split missing, orphaned and empty', () => {
  const result = stats();
  assert.equal(result.projects.total, 5);
  assert.equal(result.projects.missing, 1);
  assert.equal(result.projects.orphaned, 1);
  assert.equal(result.projects.empty, 1);
});

test('session counts and sizes separate live from archived', () => {
  const result = stats();
  assert.deepEqual(result.sessions, { live: 3, archived: 1, total: 4 });
  assert.equal(result.bytes.live, 9000);
  assert.equal(result.bytes.archived, 2000);
  assert.equal(result.bytes.total, 11000);
  assert.equal(result.bytes.average, 2750);
});

test('project totals include archived sessions, unlike Project.sessionSizeKb', () => {
  const [largest, second] = stats().largestProjects;
  assert.equal(largest.label, '~/app');
  assert.equal(largest.bytes, 8000);
  assert.equal(second.label, '~/lib');
  assert.equal(second.sessions, 2);
  assert.equal(second.bytes, 3000);
});

test('projects holding no sessions stay out of the storage table', () => {
  const labels = stats().largestProjects.map((entry) => entry.label);
  assert.ok(!labels.includes('~/blank'));
});

test('largest sessions rank by size and keep the archived tag', () => {
  const ranked = stats().largestSessions;
  assert.deepEqual(ranked.map((entry) => entry.id), ['one', 'two', 'four', 'three']);
  assert.equal(ranked[2].archived, true);
});

test('titles are used when metadata is available', () => {
  const metadata = new Map([
    ['/f/one.jsonl', { title: 'Refactor the parser', titleSource: 'ai-title' as const }],
  ]);
  const result = StatsService.compute({ projects, sessions, metadata, home: '/home/user' });
  assert.equal(result.largestSessions[0].title, 'Refactor the parser');
  assert.equal(result.largestSessions[1].title, undefined);
});

test('oldest and newest span every session, archived included', () => {
  const result = stats();
  assert.equal(result.oldest?.toISOString(), '2024-01-01T00:00:00.000Z');
  assert.equal(result.newest?.toISOString(), '2024-03-01T00:00:00.000Z');
});

test('an empty workspace produces zeros rather than NaN', () => {
  const result = StatsService.compute({ projects: [], sessions: [], home: '/home/user' });
  assert.equal(result.bytes.average, 0);
  assert.equal(result.oldest, null);
  assert.equal(result.newest, null);
  assert.match(StatsService.format(result), /No sessions found/);
});

test('the report names each section and falls back to the session id', () => {
  const text = StatsService.format(stats());
  assert.match(text, /Projects/);
  assert.match(text, /Largest projects/);
  assert.match(text, /Largest sessions/);
  assert.match(text, /one/);
});
