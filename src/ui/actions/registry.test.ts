import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildActionCategories,
  flattenActions,
  type ActionContext,
  type ActionHandlers,
} from './registry.js';
import type { Project } from '../../services/DiscoveryService.js';
import type { SessionEntry } from '../../services/SessionService.js';

const noop = () => {};

function handlers(): ActionHandlers {
  return {
    resume: noop,
    resumeDangerous: noop,
    newSession: noop,
    newSessionDangerous: noop,
    archiveSession: noop,
    restoreSession: noop,
    deleteSession: noop,
    checkIntegrity: noop,
    moveProject: noop,
    repairReferences: noop,
    packProject: noop,
    projectInfo: noop,
    removeProject: noop,
  };
}

function project(overrides: Partial<Project> = {}): Project {
  return {
    path: '/home/user/demo',
    exists: true,
    sessions: 2,
    sessionSizeKb: 10,
    lastActivity: 0,
    orphaned: false,
    encoded: '-home-user-demo',
    ...overrides,
  };
}

function session(): SessionEntry {
  return {
    id: 'aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa',
    encoded: '-home-user-demo',
    file: '/tmp/session.jsonl',
    sizeBytes: 3,
    modifiedAt: new Date(0),
    archived: false,
  };
}

function context(overrides: Partial<ActionContext> = {}): ActionContext {
  return {
    focus: 'sessions',
    project: project(),
    session: session(),
    handlers: handlers(),
    ...overrides,
  };
}

test('browsing projects treats the session as unselected', () => {
  const categories = buildActionCategories(context({ focus: 'projects' }));
  // The sessions panel highlight still exists, but from the projects panel
  // the user has not chosen a session, so no session action may appear.
  assert.ok(!categories.some((c) => c.id === 'session'));
  const labels = flattenActions(categories).map((a) => a.label);
  assert.ok(!labels.includes('Delete session'));
});

test('session actions come back once focus reaches the sessions panel', () => {
  const categories = buildActionCategories(context({ focus: 'sessions' }));
  assert.ok(categories.some((c) => c.id === 'session'));
});

test('the project category offers a new session in both modes', () => {
  const categories = buildActionCategories(context({ focus: 'projects' }));
  const actions = flattenActions(categories);
  const fresh = actions.find((a) => a.label === 'New session');
  const yolo = actions.find((a) => a.label === 'New session (yolo)');
  assert.ok(fresh && fresh.key === 'n' && !fresh.disabled);
  assert.ok(yolo && yolo.key === 'N' && yolo.danger === true);
});

test('a missing project directory disables starting a session', () => {
  const categories = buildActionCategories(
    context({ focus: 'projects', project: project({ exists: false }) }),
  );
  const fresh = flattenActions(categories).find((a) => a.label === 'New session');
  assert.ok(fresh?.disabled);
});
