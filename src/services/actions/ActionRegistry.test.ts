import test from 'node:test';
import assert from 'node:assert/strict';
import { ActionRegistry } from './ActionRegistry.js';
import { registerDefaultActions } from './register.js';
import { CATEGORY_ORDER, type ActionContext, type WorkspaceHandlers } from './types.js';
import { DEFAULT_VIEW, type WorkspaceView } from '../ViewService.js';

function handlers(record: string[]): WorkspaceHandlers {
  const spy = (name: string) => () => record.push(name);
  return {
    rescan: spy('rescan'),
    refreshMetadata: spy('refreshMetadata'),
    repairReferences: spy('repairReferences'),
    healthCheck: spy('healthCheck'),
    diagnostics: spy('diagnostics'),
    backupManager: spy('backupManager'),
    unpackArchive: spy('unpackArchive'),
    pruneOrphans: spy('pruneOrphans'),
    statistics: spy('statistics'),
    toggleArchived: spy('toggleArchived'),
  };
}

function context(overrides: Partial<ActionContext> = {}): ActionContext & { views: WorkspaceView[] } {
  const views: WorkspaceView[] = [];
  const base: ActionContext = {
    view: DEFAULT_VIEW,
    showArchived: false,
    setView: (next) => views.push(next),
    handlers: handlers([]),
    ...overrides,
  };
  return { ...base, views };
}

function list(overrides: Partial<ActionContext> = {}) {
  ActionRegistry.reset();
  registerDefaultActions();
  return ActionRegistry.list(context(overrides));
}

test('every action carries the category of the provider that made it', () => {
  for (const action of list()) {
    assert.ok(CATEGORY_ORDER.includes(action.category), `${action.id} has a real category`);
    assert.ok(action.id.startsWith(action.category), `${action.id} is namespaced by category`);
  }
});

test('actions come back grouped in category order', () => {
  const seen = list().map((action) => action.category);
  const order = [...new Set(seen)];
  assert.deepEqual(order, ['sort', 'filter', 'workspace', 'insight']);
});

test('action ids are unique, since App dispatches on them', () => {
  const ids = list().map((action) => action.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('the default sorts are marked active and nothing else is', () => {
  const active = list()
    .filter((action) => action.category === 'sort' && action.active)
    .map((action) => action.id);
  assert.deepEqual(active, ['sort.sessions.recent', 'sort.projects.active']);
});

test('choosing a sort replaces only that half of the view', () => {
  const ctx = context();
  ActionRegistry.reset();
  registerDefaultActions();
  const actions = ActionRegistry.list(ctx);

  actions.find((action) => action.id === 'sort.sessions.largest')!.run();

  assert.deepEqual(ctx.views[0].sessionSort, { field: 'size', direction: 'desc' });
  assert.deepEqual(ctx.views[0].projectSort, DEFAULT_VIEW.projectSort);
});

test('a project filter toggles off when it is already the active one', () => {
  const view: WorkspaceView = { ...DEFAULT_VIEW, projectFilter: 'missing' };
  const ctx = context({ view });
  ActionRegistry.reset();
  registerDefaultActions();
  const actions = ActionRegistry.list(ctx);

  const missing = actions.find((action) => action.id === 'filter.projects.missing')!;
  assert.equal(missing.active, true);
  missing.run();
  assert.equal(ctx.views[0].projectFilter, 'none');
});

test('clear filter is offered only while a filter is on', () => {
  const idle = list().map((action) => action.id);
  assert.ok(!idle.includes('filter.clear'));

  const filtered = list({ view: { ...DEFAULT_VIEW, projectFilter: 'empty' } }).map((a) => a.id);
  assert.ok(filtered.includes('filter.clear'));
});

test('the archived entry reflects which list is showing', () => {
  const live = list().find((action) => action.id === 'filter.archived')!;
  assert.equal(live.active, false);
  assert.match(live.subtitle ?? '', /live/);

  const archived = list({ showArchived: true }).find((a) => a.id === 'filter.archived')!;
  assert.equal(archived.active, true);
  assert.match(archived.subtitle ?? '', /archive/);
});

test('workspace actions run the handler they name', () => {
  const record: string[] = [];
  const actions = list({ handlers: handlers(record) });
  actions.find((action) => action.id === 'workspace.health')!.run();
  actions.find((action) => action.id === 'insight.statistics')!.run();
  assert.deepEqual(record, ['healthCheck', 'statistics']);
});

test('prune is the only destructive workspace action', () => {
  const danger = list()
    .filter((action) => action.danger)
    .map((action) => action.id);
  assert.deepEqual(danger, ['workspace.prune']);
});

test('registering the same provider twice does not duplicate its actions', () => {
  ActionRegistry.reset();
  registerDefaultActions();
  registerDefaultActions();
  const ids = ActionRegistry.list(context()).map((action) => action.id);
  assert.equal(new Set(ids).size, ids.length);
});
