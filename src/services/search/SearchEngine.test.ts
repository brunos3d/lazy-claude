import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { SearchEngine } from './SearchEngine.js';
import type { ResultKind, SearchHit, SearchProvider, WorkspaceIndex } from './types.js';

const index: WorkspaceIndex = {
  projects: [],
  sessions: [],
  metadata: new Map(),
  projectLabels: new Map(),
  home: os.homedir(),
  status: 'ready',
  done: 0,
  total: 0,
};

function hit(kind: ResultKind, n: number): SearchHit {
  return {
    id: `${kind}:${n}`,
    kind,
    title: `${kind} ${n}`,
    score: n,
    target: { kind: 'project', encoded: `enc-${n}` },
  };
}

function provider(options: {
  id: string;
  kind: ResultKind;
  hits: number;
  enabled?: boolean;
  throws?: boolean;
  gate?: Promise<void>;
}): SearchProvider {
  return {
    id: options.id,
    kind: options.kind,
    title: options.id,
    enabled: () => options.enabled ?? true,
    async search() {
      if (options.gate) await options.gate;
      if (options.throws) throw new Error('provider exploded');
      return Array.from({ length: options.hits }, (_, i) => hit(options.kind, i));
    },
  };
}

test('groups render in GROUP_ORDER regardless of registration order', async () => {
  SearchEngine.reset();
  SearchEngine.register(provider({ id: 'messages', kind: 'message', hits: 1 }));
  SearchEngine.register(provider({ id: 'sessions', kind: 'session', hits: 1 }));
  SearchEngine.register(provider({ id: 'projects', kind: 'project', hits: 1 }));

  const groups = await SearchEngine.search('x', index);
  assert.deepEqual(groups.map((g) => g.kind), ['project', 'session', 'message']);
});

test('drops groups with no hits', async () => {
  SearchEngine.reset();
  SearchEngine.register(provider({ id: 'projects', kind: 'project', hits: 2 }));
  SearchEngine.register(provider({ id: 'sessions', kind: 'session', hits: 0 }));

  const groups = await SearchEngine.search('x', index);
  assert.deepEqual(groups.map((g) => g.kind), ['project']);
});

test('returns every hit, so nothing is unreachable from the palette', async () => {
  SearchEngine.reset();
  SearchEngine.register(provider({ id: 'sessions', kind: 'session', hits: 400 }));

  const [group] = await SearchEngine.search('x', index);
  assert.equal(group.hits.length, 400);
  // The last hit must survive: the palette scrolls the whole group in its
  // own tab, so a ceiling here would silently hide results.
  assert.equal(group.hits.at(-1)?.id, 'session:399');
});

test('skips providers that report themselves disabled', async () => {
  SearchEngine.reset();
  SearchEngine.register(provider({ id: 'projects', kind: 'project', hits: 1 }));
  SearchEngine.register(provider({ id: 'messages', kind: 'message', hits: 5, enabled: false }));

  const groups = await SearchEngine.search('x', index);
  assert.deepEqual(groups.map((g) => g.kind), ['project']);
});

test('one failing provider does not take down the others', async () => {
  SearchEngine.reset();
  SearchEngine.register(provider({ id: 'projects', kind: 'project', hits: 1 }));
  SearchEngine.register(provider({ id: 'sessions', kind: 'session', hits: 3, throws: true }));

  const groups = await SearchEngine.search('x', index);
  assert.deepEqual(groups.map((g) => g.kind), ['project']);
});

test('an empty query returns no groups without running providers', async () => {
  SearchEngine.reset();
  let ran = false;
  SearchEngine.register({
    id: 'projects',
    kind: 'project',
    title: 'Projects',
    enabled: () => true,
    async search() {
      ran = true;
      return [hit('project', 0)];
    },
  });

  assert.deepEqual(await SearchEngine.search('   ', index), []);
  assert.equal(ran, false);
});

test('a superseded search resolves empty', async () => {
  SearchEngine.reset();
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  SearchEngine.register(provider({ id: 'projects', kind: 'project', hits: 2, gate }));

  const first = SearchEngine.search('old', index);
  const second = SearchEngine.search('new', index);
  release();

  assert.deepEqual(await first, []);
  assert.equal((await second).length, 1);
});

test('registering the same id twice replaces the provider', async () => {
  SearchEngine.reset();
  SearchEngine.register(provider({ id: 'projects', kind: 'project', hits: 1 }));
  SearchEngine.register(provider({ id: 'projects', kind: 'project', hits: 3 }));

  const [group] = await SearchEngine.search('x', index);
  assert.equal(group.hits.length, 3);
});
