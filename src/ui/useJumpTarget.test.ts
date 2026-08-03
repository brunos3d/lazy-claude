import test from 'node:test';
import assert from 'node:assert/strict';
import type { Project } from '../services/DiscoveryService.js';
import type { ProjectItem } from './types.js';
import { pendingKey, planJump } from './useJumpTarget.js';

const project = (encoded: string): Project => ({
  path: `/home/dev/${encoded}`,
  exists: true,
  sessions: 1,
  sessionSizeKb: 1,
  lastActivity: 0,
  orphaned: false,
  encoded,
});

const items: ProjectItem[] = [
  { kind: 'all' },
  { kind: 'project', project: project('alpha') },
  { kind: 'project', project: project('beta') },
];

test('a project jump selects the project and focuses the projects panel', () => {
  const plan = planJump({ kind: 'project', encoded: 'beta' }, items);
  assert.deepEqual(plan, {
    projectIndex: 2,
    showArchived: null,
    focus: 'projects',
    detailTab: null,
    pending: null,
  });
});

test('a session jump records a pending selection and focuses sessions', () => {
  const plan = planJump(
    { kind: 'session', encoded: 'alpha', file: '/s/alpha/one.jsonl', archived: false },
    items,
  );
  assert.deepEqual(plan, {
    projectIndex: 1,
    showArchived: false,
    focus: 'sessions',
    detailTab: null,
    pending: { key: pendingKey('alpha', false), file: '/s/alpha/one.jsonl' },
  });
});

test('an archived session jump flips the archived toggle', () => {
  const plan = planJump(
    { kind: 'session', encoded: 'alpha', file: '/s/alpha/old.jsonl', archived: true },
    items,
  );
  assert.equal(plan?.showArchived, true);
  assert.equal(plan?.pending?.key, pendingKey('alpha', true));
});

test('a message jump opens the conversation tab in the details panel', () => {
  const plan = planJump(
    { kind: 'message', encoded: 'beta', file: '/s/beta/one.jsonl', archived: false },
    items,
  );
  assert.equal(plan?.focus, 'details');
  assert.equal(plan?.detailTab, 'conversation');
  assert.equal(plan?.pending?.file, '/s/beta/one.jsonl');
});

test('a target whose project is gone plans nothing', () => {
  assert.equal(planJump({ kind: 'project', encoded: 'ghost' }, items), null);
});

test('pendingKey separates live and archived views of one project', () => {
  assert.notEqual(pendingKey('alpha', false), pendingKey('alpha', true));
});
