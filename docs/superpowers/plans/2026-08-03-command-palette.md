# Command Palette Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global `ctrl+k` command palette to the Lazy Claude TUI that searches every project and session in the workspace and jumps the interface to the selected result.

**Architecture:** A provider-based search layer under `src/services/search/` owns data (`SearchIndexer`), orchestration (`SearchEngine`), and per-domain matching (providers). The palette is an overlay that renders results and nothing else. Navigation lives in `useJumpTarget`, which bridges the asynchronous gap between selecting a project and its sessions finishing loading.

**Tech Stack:** TypeScript (strict, `module: NodeNext`), Ink 7, React 19, Node's built-in `node:test`. No new dependencies of any kind.

**Spec:** `docs/superpowers/specs/2026-08-03-command-palette-design.md`

## Global Constraints

- ESM throughout. Every relative import carries the `.js` extension, including from `.tsx` files.
- Runtime dependencies stay `ink`, `react`, `tar`. Add no dependencies and no devDependencies. `node:test` is a Node builtin.
- `npm run build` must pass. `tsc` under `strict` is the only type check.
- Never drop `node scripts/chmod-bin.mjs` from the build script.
- Never decode an encoded project folder name back to a path. Match forward from a known path via `encodeProjectPath`, or join on `encoded`.
- Modal rows compute their background padding from `text.length`, so every string rendered inside a modal must be single-width. Reuse only glyphs already present in `dialogs.tsx`: `…`, `│`, `─`, `↑`, `↓`, `>`. No wide or ambiguous-width characters, and no new Unicode ornaments. The palette's prompt is a plain `>`, the same one `InputDialog` uses; its visual distinction comes from the round border, the blue accent, the larger input row, and the layout.
- Never call Ink's `useInput` directly. Use `useOverlayInput(id, ...)` inside overlays and `useAppInput(...)` in app components.
- Comments explain why a constraint exists, not what the code does.
- `src/core/` stays pure. `src/services/` holds all business logic and every read of Claude Code's on-disk format. `src/ui/` never parses session records or touches the filesystem.
- Exercise anything destructive against a throwaway `LAZY_CLAUDE_CLAUDE_DIR`.

---

### Task 1: Test runner and ranking tiers

Sets up `node:test` and uses it immediately for the shared ranking change. The tier change lands first because every later task depends on `FilterService` behaviour.

**Files:**
- Modify: `package.json:34-40` (scripts), `package.json:28-30` (files)
- Modify: `src/services/FilterService.ts`
- Test: `src/services/FilterService.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `matchTier(value: string, query: string): MatchTier` and `TIER_WEIGHT: number` exported from `src/services/FilterService.ts`. `FilterService.filter` keeps its existing signature `<T>(documents: Array<SearchDocument<T>>, query: string) => Array<SearchResult<T>>`.

- [ ] **Step 1: Add the test script and keep tests out of the published package**

In `package.json`, change the `files` array and add a `test` script:

```json
  "files": [
    "dist",
    "!dist/**/*.test.js"
  ],
```

```json
  "scripts": {
    "build": "tsc && node scripts/chmod-bin.mjs",
    "dev": "tsc --watch",
    "start": "node dist/cli.js",
    "test": "tsc && node --test dist",
    "prepare": "npm run build",
    "prepublishOnly": "npm run build"
  },
```

Tests live beside their source as `src/**/*.test.ts` so the existing `tsconfig.json` (`rootDir: "src"`, `include: ["src"]`) compiles them with no second config. `node --test dist` recursively finds `*.test.js`. The `!dist/**/*.test.js` negation keeps them out of the npm tarball.

- [ ] **Step 2: Write the failing test**

Create `src/services/FilterService.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { FilterService, matchTier, type SearchDocument } from './FilterService.js';

const doc = (label: string): SearchDocument<string> => ({
  item: label,
  fields: [{ key: 'label', value: label, weight: 1, highlight: true }],
});

test('matchTier classifies exact, prefix, substring and subsequence', () => {
  assert.equal(matchTier('docker', 'docker'), 3);
  assert.equal(matchTier('Docker', 'docker'), 3);
  assert.equal(matchTier('docker-compose', 'docker'), 2);
  assert.equal(matchTier('my-docker-setup', 'docker'), 1);
  assert.equal(matchTier('do not call the broker', 'docker'), 0);
});

test('tiers order results ahead of raw fuzzy score', () => {
  const results = FilterService.filter(
    [
      doc('do not call the broker'),
      doc('my-docker-setup'),
      doc('docker-compose'),
      doc('docker'),
    ],
    'docker',
  );
  assert.deepEqual(results.map((r) => r.item), [
    'docker',
    'docker-compose',
    'my-docker-setup',
    'do not call the broker',
  ]);
});

test('ties inside a tier keep the caller order, which is recency', () => {
  const results = FilterService.filter([doc('alpha-tool'), doc('alpha-kit')], 'alpha');
  assert.deepEqual(results.map((r) => r.item), ['alpha-tool', 'alpha-kit']);
});

test('an empty query returns every document untouched', () => {
  const results = FilterService.filter([doc('one'), doc('two')], '   ');
  assert.deepEqual(results.map((r) => r.item), ['one', 'two']);
  assert.equal(results[0].score, 0);
});

test('highlight positions still come back for highlighted fields', () => {
  const [result] = FilterService.filter([doc('docker')], 'dkr');
  assert.deepEqual(result.highlights.label, [0, 3, 5]);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL. `matchTier` is not exported from `FilterService.ts`, so `tsc` errors with "Module ... has no exported member 'matchTier'".

- [ ] **Step 4: Implement the tiers**

In `src/services/FilterService.ts`, add above `class FilterServiceImpl`:

```ts
/**
 * How directly a query hit a field, independent of fuzzy score.
 *
 * Fuzzy subsequence scoring alone lets a long scattered match outrank a
 * short literal one, which reads as broken: typing a project's exact name
 * should never bury it. Tiers dominate the score so that ordering is
 * guaranteed, and the fuzzy score only decides ties inside a tier.
 */
export type MatchTier = 0 | 1 | 2 | 3;

export function matchTier(value: string, query: string): MatchTier {
  const haystack = value.toLowerCase();
  const needle = query.toLowerCase();
  if (haystack === needle) return 3;
  if (haystack.startsWith(needle)) return 2;
  if (haystack.includes(needle)) return 1;
  return 0;
}

/**
 * Larger than any reachable fuzzy score. `core/fuzzy.ts` caps a character
 * at SCORE_MATCH + BONUS_BOUNDARY + BONUS_FIRST_CHAR + BONUS_CONSECUTIVE,
 * so no realistic query gets near this and tiers stay strictly separated.
 */
export const TIER_WEIGHT = 10000;
```

Then replace the scoring line inside `filter`:

```ts
      for (const field of document.fields) {
        if (!field.value) continue;
        const match = fuzzyMatch(field.value, trimmed);
        if (!match) continue;
        const weighted =
          matchTier(field.value, trimmed) * TIER_WEIGHT + match.score * field.weight;
        if (weighted > best) best = weighted;
        if (field.highlight) highlights[field.key] = match.positions;
      }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add package.json src/services/FilterService.ts src/services/FilterService.test.ts
git commit -m "feat(search): rank exact and prefix matches above fuzzy ones"
```

---

### Task 2: Shared row windowing

Extracts the scroll math `ActionMenu` already has so the palette can reuse it. Infrastructure extraction only. Do not restructure `dialogs.tsx`.

**Files:**
- Create: `src/ui/overlay/window.ts`
- Test: `src/ui/overlay/window.test.ts`
- Modify: `src/ui/overlay/dialogs.tsx:269-289` (the `ActionMenu` offset block)

**Interfaces:**
- Consumes: nothing.
- Produces: `resolveRowOffset(options: { base: number; row: number; viewport: number; rowCount: number; headerAbove: boolean }): number` from `src/ui/overlay/window.ts`.

- [ ] **Step 1: Write the failing test**

Create `src/ui/overlay/window.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveRowOffset } from './window.js';

const call = (over: Partial<Parameters<typeof resolveRowOffset>[0]>) =>
  resolveRowOffset({ base: 0, row: 0, viewport: 5, rowCount: 20, headerAbove: false, ...over });

test('keeps the offset when the row is already visible', () => {
  assert.equal(call({ base: 3, row: 5 }), 3);
});

test('scrolls down just enough to reveal a row below the viewport', () => {
  assert.equal(call({ base: 0, row: 7 }), 3);
});

test('scrolls up to the row when it sits above the viewport', () => {
  assert.equal(call({ base: 10, row: 4 }), 4);
});

test('pulls a directly preceding header into view with its row', () => {
  assert.equal(call({ base: 10, row: 4, headerAbove: true }), 3);
});

test('clamps to the last full page', () => {
  assert.equal(call({ base: 99, row: 19, rowCount: 20, viewport: 5 }), 15);
});

test('returns 0 when everything fits', () => {
  assert.equal(call({ base: 4, row: 2, rowCount: 3, viewport: 5 }), 0);
});

test('never returns a negative offset', () => {
  assert.equal(call({ base: -5, row: 0, headerAbove: true }), 0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL. `tsc` errors with "Cannot find module './window.js'".

- [ ] **Step 3: Implement the helper**

Create `src/ui/overlay/window.ts`:

```ts
/**
 * Scroll-offset math for windowed overlay lists.
 *
 * Ink does not clip overflow, so every list overlay renders a slice of its
 * rows and tracks its own offset. Both the action menu and the command
 * palette interleave headers with selectable rows, so both need the same
 * rule: keep the selected row on screen, and bring its group header along
 * with it when the header sits directly above.
 */
export interface RowOffsetOptions {
  /** Current offset, before this selection change. */
  base: number;
  /** Index of the row that must be visible. */
  row: number;
  /** Rows the viewport can show. */
  viewport: number;
  /** Total rows in the flattened list. */
  rowCount: number;
  /** True when the row directly above `row` is a group header. */
  headerAbove: boolean;
}

export function resolveRowOffset({
  base,
  row,
  viewport,
  rowCount,
  headerAbove,
}: RowOffsetOptions): number {
  const maxScroll = Math.max(0, rowCount - viewport);
  let next = Math.min(Math.max(0, base), maxScroll);
  if (row < next) next = row;
  else if (row >= next + viewport) next = row - viewport + 1;
  if (headerAbove && row - 1 < next) next = row - 1;
  return Math.max(0, Math.min(next, maxScroll));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS, 12 tests total.

- [ ] **Step 5: Point ActionMenu at the shared helper**

In `src/ui/overlay/dialogs.tsx`, add to the imports:

```ts
import { resolveRowOffset } from './window.js';
```

Replace the local `maxScroll` constant and `resolveOffset` function (currently the block starting `const maxScroll = Math.max(0, rowList.length - viewport);` through the end of `resolveOffset`) with:

```ts
  /** Clamp an offset so the selected action, and its header, stay visible. */
  const resolveOffset = (base: number, actionIndex: number) => {
    const row = rowOfAction[actionIndex] ?? 0;
    return resolveRowOffset({
      base,
      row,
      viewport,
      rowCount: rowList.length,
      headerAbove: rowList[row - 1]?.kind === 'header',
    });
  };
```

Change nothing else in `dialogs.tsx`. `MenuRow`, `renderRow`, the column-width logic, the chrome tiers, and the footer stay exactly as they are.

- [ ] **Step 6: Verify the build and the menu still behave**

Run: `npm test`
Expected: PASS, and `tsc` reports no errors.

- [ ] **Step 7: Commit**

```bash
git add src/ui/overlay/window.ts src/ui/overlay/window.test.ts src/ui/overlay/dialogs.tsx
git commit -m "refactor(overlay): extract shared row windowing helper"
```

---

### Task 3: Search types and history

`types.ts` carries no runtime behaviour, so it ships alongside the first thing that is testable.

**Files:**
- Create: `src/services/search/types.ts`
- Create: `src/services/search/SearchHistory.ts`
- Test: `src/services/search/SearchHistory.test.ts`

**Interfaces:**
- Consumes: `Project` from `../DiscoveryService.js`, `SessionEntry` from `../SessionService.js`, `SessionMetadata` from `../SessionMetadataService.js`.
- Produces: `ResultKind`, `JumpTarget`, `SearchHit`, `SearchGroup`, `WorkspaceIndex`, `SearchContext`, `SearchProvider` from `src/services/search/types.js`. `SearchHistory` singleton with `record(query: string): void`, `list(): string[]`, `clear(): void`.

- [ ] **Step 1: Create the shared types**

Create `src/services/search/types.ts`:

```ts
import type { Project } from '../DiscoveryService.js';
import type { SessionEntry } from '../SessionService.js';
import type { SessionMetadata } from '../SessionMetadataService.js';

/**
 * Vocabulary shared by the search engine, its providers, and the command
 * palette. Nothing here imports Ink or React: the palette is one consumer
 * of this layer, not its owner.
 */

export type ResultKind = 'project' | 'session' | 'message';

/**
 * Where selecting a result lands the interface.
 *
 * `encoded` is the join key throughout, because it is the only stable
 * identifier shared by Project, SessionEntry, and the archive tree. It is
 * never decoded back into a path.
 */
export type JumpTarget =
  | { kind: 'project'; encoded: string }
  | { kind: 'session'; encoded: string; file: string; archived: boolean }
  | { kind: 'message'; encoded: string; file: string; archived: boolean; anchor?: number };

/**
 * One row of the palette.
 *
 * This describes how a result is displayed and where it navigates, and
 * deliberately nothing else. A provider that needs extra data puts it in
 * `payload`, which the engine and the palette treat as opaque. Growing
 * this type with per-provider optional fields is what would stop it
 * working for every kind of result at once.
 */
export interface SearchHit {
  /** Stable identity, used as the React key. */
  id: string;
  kind: ResultKind;
  /** Primary line. */
  title: string;
  /** Match positions in `title`, for highlighting. */
  highlights?: number[];
  /** Second line: project path, or the owning project of a session. */
  subtitle?: string;
  /** Muted trailing text: relative time, session count, archived tag. */
  meta?: string;
  score: number;
  target: JumpTarget;
  /** Provider-owned extra data. Opaque to the engine and the palette. */
  payload?: unknown;
}

export interface SearchGroup {
  kind: ResultKind;
  /** Header text, for example "Projects". */
  title: string;
  /** Already capped to the provider's limit. */
  hits: SearchHit[];
  /** Hit count before the cap, for the "+N more" line. */
  total: number;
}

/** One in-memory snapshot of the workspace. Queries never touch disk. */
export interface WorkspaceIndex {
  projects: Project[];
  /** Live and archived, in one list. */
  sessions: SessionEntry[];
  metadata: Map<string, SessionMetadata>;
  /** encoded -> display label, for session subtitles. */
  projectLabels: Map<string, string>;
  home: string;
  status: 'empty' | 'building' | 'ready';
  /** Metadata progress while building. */
  done: number;
  total: number;
}

/**
 * The single extension point for providers. New shared inputs (a clock, a
 * deadline, a locale) become fields here and change no provider signature.
 */
export interface SearchContext {
  index: WorkspaceIndex;
  signal: AbortSignal;
}

/**
 * A provider describes what it provides, not where it appears. Group
 * ordering belongs to SearchEngine; `limit` stays here because how many
 * results are useful is intrinsic to the domain.
 *
 * Providers are stateless and independent: none reads another's output,
 * imports another, or assumes one has already run. That is what lets the
 * engine run them all in parallel.
 */
export interface SearchProvider {
  id: string;
  kind: ResultKind;
  /** Group header text. */
  title: string;
  /** Maximum hits shown in the palette. */
  limit: number;
  enabled(context: SearchContext): boolean;
  search(query: string, context: SearchContext): Promise<SearchHit[]>;
}
```

- [ ] **Step 2: Write the failing test**

Create `src/services/search/SearchHistory.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { SearchHistory } from './SearchHistory.js';

test('records queries newest first', () => {
  SearchHistory.clear();
  SearchHistory.record('docker');
  SearchHistory.record('billing');
  assert.deepEqual(SearchHistory.list(), ['billing', 'docker']);
});

test('re-running a query moves it to the front instead of duplicating', () => {
  SearchHistory.clear();
  SearchHistory.record('docker');
  SearchHistory.record('billing');
  SearchHistory.record('DOCKER');
  assert.deepEqual(SearchHistory.list(), ['DOCKER', 'billing']);
});

test('caps at ten entries', () => {
  SearchHistory.clear();
  for (let i = 0; i < 15; i++) SearchHistory.record(`query-${i}`);
  const list = SearchHistory.list();
  assert.equal(list.length, 10);
  assert.equal(list[0], 'query-14');
  assert.equal(list[9], 'query-5');
});

test('ignores empty and whitespace-only queries', () => {
  SearchHistory.clear();
  SearchHistory.record('');
  SearchHistory.record('   ');
  assert.deepEqual(SearchHistory.list(), []);
});

test('trims recorded queries', () => {
  SearchHistory.clear();
  SearchHistory.record('  docker  ');
  assert.deepEqual(SearchHistory.list(), ['docker']);
});

test('list returns a copy, so callers cannot mutate the history', () => {
  SearchHistory.clear();
  SearchHistory.record('docker');
  SearchHistory.list().push('injected');
  assert.deepEqual(SearchHistory.list(), ['docker']);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL. `tsc` errors with "Cannot find module './SearchHistory.js'".

- [ ] **Step 4: Implement the history**

Create `src/services/search/SearchHistory.ts`:

```ts
const LIMIT = 10;

/**
 * Recent palette queries, for the process lifetime only.
 *
 * Deliberately not persisted: this exists to make a second search in the
 * same sitting cheap, not to build a profile across runs.
 *
 * It lives in a service rather than in palette state because the palette
 * unmounts every time it closes, and only queries that produced a jump are
 * recorded, which is what keeps abandoned half-typed prefixes out.
 */
class SearchHistoryImpl {
  private queries: string[] = [];

  record(query: string): void {
    const trimmed = query.trim();
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    this.queries = [trimmed, ...this.queries.filter((q) => q.toLowerCase() !== lower)].slice(
      0,
      LIMIT,
    );
  }

  list(): string[] {
    return [...this.queries];
  }

  clear(): void {
    this.queries = [];
  }
}

export const SearchHistory = new SearchHistoryImpl();
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test`
Expected: PASS, 18 tests total.

- [ ] **Step 6: Commit**

```bash
git add src/services/search/types.ts src/services/search/SearchHistory.ts src/services/search/SearchHistory.test.ts
git commit -m "feat(search): add search layer types and session-scoped query history"
```

---

### Task 4: Workspace index

Builds the snapshot every provider reads. Also adds progress reporting to `SessionMetadataService.getMany` so a cold cache streams instead of stalling.

**Files:**
- Modify: `src/services/SessionMetadataService.ts:56-85` (`getMany`)
- Create: `src/services/search/SearchIndexer.ts`
- Test: `src/services/search/SearchIndexer.test.ts`

**Interfaces:**
- Consumes: `WorkspaceIndex` from `./types.js`, `DiscoveryService.discoverProjects()`, `listAllSessions()`, `listAllArchivedSessions()`, `SessionMetadataService.getMany`.
- Produces: `SearchIndexer` singleton with `snapshot(): WorkspaceIndex`, `subscribe(listener: (index: WorkspaceIndex) => void): () => void`, `warm(projects?: Project[]): Promise<void>`, `invalidate(): void`. `SessionMetadataService.getMany(sessions, onProgress?)` where `onProgress` is `(progress: { done: number; total: number; metadata: Map<string, SessionMetadata> }) => void`.

- [ ] **Step 1: Write the failing test**

Create `src/services/search/SearchIndexer.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { encodeProjectPath } from '../../core/paths.js';
import type { Project } from '../DiscoveryService.js';
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL. `tsc` errors with "Cannot find module './SearchIndexer.js'".

- [ ] **Step 3: Add progress reporting to getMany**

In `src/services/SessionMetadataService.ts`, replace the `getMany` method with:

```ts
  /**
   * Metadata for many sessions. Uncached files are parsed with bounded
   * concurrency so a large project does not open hundreds of files at once.
   *
   * `onProgress` receives the live result map, not a copy, so a caller
   * showing progress can render partial titles without paying an O(n) copy
   * per batch. The map is complete once the returned promise resolves.
   */
  async getMany(
    sessions: SessionEntry[],
    onProgress?: (progress: {
      done: number;
      total: number;
      metadata: Map<string, SessionMetadata>;
    }) => void,
  ): Promise<Map<string, SessionMetadata>> {
    await this.cache.load();
    const result = new Map<string, SessionMetadata>();
    const pending: SessionEntry[] = [];

    for (const session of sessions) {
      const cached = this.cache.get(session.file, session.sizeBytes, session.modifiedAt.getTime());
      if (cached) result.set(session.file, cached);
      else pending.push(session);
    }

    onProgress?.({ done: result.size, total: sessions.length, metadata: result });

    const CONCURRENCY = 12;
    for (let i = 0; i < pending.length; i += CONCURRENCY) {
      const batch = pending.slice(i, i + CONCURRENCY);
      const parsed = await Promise.all(
        batch.map(async (session) => [session, await this.parse(session)] as const),
      );
      for (const [session, metadata] of parsed) {
        this.cache.set(session.file, session.sizeBytes, session.modifiedAt.getTime(), metadata);
        result.set(session.file, metadata);
      }
      onProgress?.({ done: result.size, total: sessions.length, metadata: result });
    }

    await this.cache.save();
    return result;
  }
```

The existing caller in `App.tsx` passes one argument and is unaffected.

- [ ] **Step 4: Implement the indexer**

Create `src/services/search/SearchIndexer.ts`:

```ts
import os from 'node:os';
import { shortenPath } from '../../core/format.js';
import { DiscoveryService, type Project } from '../DiscoveryService.js';
import { SessionMetadataService } from '../SessionMetadataService.js';
import { listAllArchivedSessions, listAllSessions } from '../SessionService.js';
import type { WorkspaceIndex } from './types.js';

type Listener = (index: WorkspaceIndex) => void;

function emptyIndex(): WorkspaceIndex {
  return {
    projects: [],
    sessions: [],
    metadata: new Map(),
    projectLabels: new Map(),
    home: os.homedir(),
    status: 'empty',
    done: 0,
    total: 0,
  };
}

/**
 * The workspace snapshot every search provider reads.
 *
 * Built once in the background and reused, so opening the palette never
 * triggers a scan and never waits for one. Queries run entirely against
 * what is already in memory; a build in flight simply means fewer results
 * for a moment, never a blocked interface.
 *
 * Builds are generation-stamped. `invalidate()` bumps the generation, so a
 * build racing against a rescan discards its own results instead of
 * publishing a stale snapshot over a fresh one.
 */
class SearchIndexerImpl {
  private index: WorkspaceIndex = emptyIndex();
  private listeners = new Set<Listener>();
  private building: { generation: number; promise: Promise<void> } | null = null;
  private generation = 0;

  snapshot(): WorkspaceIndex {
    return this.index;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Start a background build, or join the one already running. Callers
   * fire and forget: the palette reads `snapshot()` and re-renders from
   * `subscribe()` instead of awaiting this.
   *
   * `projects` lets App hand over the list its own discovery effect just
   * produced, so discovery does not run twice on startup.
   */
  warm(projects?: Project[]): Promise<void> {
    if (this.building) return this.building.promise;
    const generation = ++this.generation;
    const promise = this.build(generation, projects).finally(() => {
      if (this.building?.generation === generation) this.building = null;
    });
    this.building = { generation, promise };
    return promise;
  }

  /** Drop the snapshot and abandon any build in flight. */
  invalidate(): void {
    this.generation += 1;
    this.building = null;
    this.index = emptyIndex();
    this.publish();
  }

  private async build(generation: number, seed?: Project[]): Promise<void> {
    const home = os.homedir();
    const projects = seed ?? (await DiscoveryService.discoverProjects());
    if (generation !== this.generation) return;

    const projectLabels = new Map<string, string>();
    for (const project of projects) {
      projectLabels.set(
        project.encoded,
        project.orphaned ? project.encoded : shortenPath(project.path, home),
      );
    }

    this.index = {
      ...emptyIndex(),
      home,
      projects,
      projectLabels,
      status: 'building',
    };
    this.publish();

    // Archived sessions are indexed too, so the palette can find a session
    // the user hid and flip the archived toggle on the way to it.
    const [live, archived] = await Promise.all([listAllSessions(), listAllArchivedSessions()]);
    if (generation !== this.generation) return;

    const sessions = [...live, ...archived];
    this.index = { ...this.index, sessions, total: sessions.length };
    this.publish();

    const metadata = await SessionMetadataService.getMany(sessions, (progress) => {
      if (generation !== this.generation) return;
      this.index = {
        ...this.index,
        metadata: progress.metadata,
        done: progress.done,
        total: progress.total,
      };
      this.publish();
    });
    if (generation !== this.generation) return;

    this.index = {
      ...this.index,
      metadata,
      status: 'ready',
      done: sessions.length,
      total: sessions.length,
    };
    this.publish();
  }

  private publish(): void {
    for (const listener of this.listeners) listener(this.index);
  }
}

export const SearchIndexer = new SearchIndexerImpl();
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test`
Expected: PASS, 21 tests total.

- [ ] **Step 6: Commit**

```bash
git add src/services/SessionMetadataService.ts src/services/search/SearchIndexer.ts src/services/search/SearchIndexer.test.ts
git commit -m "feat(search): build a background workspace index for global search"
```

---

### Task 5: Search engine

**Files:**
- Create: `src/services/search/SearchEngine.ts`
- Test: `src/services/search/SearchEngine.test.ts`

**Interfaces:**
- Consumes: `SearchProvider`, `SearchGroup`, `SearchContext`, `WorkspaceIndex`, `ResultKind` from `./types.js`.
- Produces: `SearchEngine` singleton with `register(provider: SearchProvider): void`, `reset(): void`, `search(query: string, index: WorkspaceIndex): Promise<SearchGroup[]>`.

- [ ] **Step 1: Write the failing test**

Create `src/services/search/SearchEngine.test.ts`:

```ts
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
  limit?: number;
  enabled?: boolean;
  throws?: boolean;
  gate?: Promise<void>;
}): SearchProvider {
  return {
    id: options.id,
    kind: options.kind,
    title: options.id,
    limit: options.limit ?? 10,
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

test('caps hits at the provider limit but reports the true total', async () => {
  SearchEngine.reset();
  SearchEngine.register(provider({ id: 'sessions', kind: 'session', hits: 40, limit: 12 }));

  const [group] = await SearchEngine.search('x', index);
  assert.equal(group.hits.length, 12);
  assert.equal(group.total, 40);
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
    limit: 6,
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
  assert.equal(group.total, 3);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL. `tsc` errors with "Cannot find module './SearchEngine.js'".

- [ ] **Step 3: Implement the engine**

Create `src/services/search/SearchEngine.ts`:

```ts
import type {
  ResultKind,
  SearchContext,
  SearchGroup,
  SearchProvider,
  WorkspaceIndex,
} from './types.js';

/**
 * Presentation order of result groups.
 *
 * This is the engine's decision, not a provider's. A provider describes
 * what it provides; where its group sits is a layout question, and keeping
 * it here means the same query always puts the same kind of result in the
 * same place no matter what order providers registered in.
 */
const GROUP_ORDER: ResultKind[] = ['project', 'session', 'message'];

/**
 * Runs registered providers against one workspace snapshot.
 *
 * The engine owns the request lifecycle: it builds the SearchContext, owns
 * the AbortController, and aborts the previous run when a new query
 * arrives. Providers never construct either.
 */
class SearchEngineImpl {
  private providers: SearchProvider[] = [];
  private controller: AbortController | null = null;

  register(provider: SearchProvider): void {
    this.providers = this.providers.filter((p) => p.id !== provider.id).concat(provider);
  }

  /** Drop every provider and cancel any run in flight. Used by tests. */
  reset(): void {
    this.controller?.abort();
    this.controller = null;
    this.providers = [];
  }

  async search(query: string, index: WorkspaceIndex): Promise<SearchGroup[]> {
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;

    const trimmed = query.trim();
    if (!trimmed) return [];

    const context: SearchContext = { index, signal: controller.signal };
    const active = this.providers.filter((provider) => provider.enabled(context));

    // A provider that throws must not take the palette down with it, and
    // must not deny the other groups their results. Independence is the
    // property that makes running them in parallel safe.
    const settled = await Promise.all(
      active.map(async (provider) => {
        try {
          return { provider, hits: await provider.search(trimmed, context) };
        } catch {
          return { provider, hits: [] };
        }
      }),
    );

    if (controller.signal.aborted) return [];

    const groups: SearchGroup[] = [];
    for (const { provider, hits } of settled) {
      if (hits.length === 0) continue;
      groups.push({
        kind: provider.kind,
        title: provider.title,
        hits: hits.slice(0, provider.limit),
        total: hits.length,
      });
    }

    groups.sort((a, b) => GROUP_ORDER.indexOf(a.kind) - GROUP_ORDER.indexOf(b.kind));
    return groups;
  }
}

export const SearchEngine = new SearchEngineImpl();
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS, 29 tests total.

- [ ] **Step 5: Commit**

```bash
git add src/services/search/SearchEngine.ts src/services/search/SearchEngine.test.ts
git commit -m "feat(search): add provider orchestration engine"
```

---

### Task 6: Providers

**Files:**
- Create: `src/services/search/providers/ProjectProvider.ts`
- Create: `src/services/search/providers/SessionProvider.ts`
- Create: `src/services/search/providers/ConversationProvider.ts`
- Create: `src/services/search/register.ts`
- Test: `src/services/search/providers/providers.test.ts`

**Interfaces:**
- Consumes: `SearchService.filterProjects`, `SearchService.filterSessions`, `LABEL_FIELD` from `../../SearchService.js`; `formatRelativeTime`, `shortenPath` from `../../../core/format.js`; `SearchProvider`, `SearchHit` from `../types.js`.
- Produces: `ProjectProvider`, `SessionProvider`, `ConversationProvider` (each a `SearchProvider`), and `registerDefaultProviders(): void` from `src/services/search/register.js`.

- [ ] **Step 1: Write the failing test**

Create `src/services/search/providers/providers.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL. `tsc` errors with "Cannot find module './ConversationProvider.js'".

- [ ] **Step 3: Implement ProjectProvider**

Create `src/services/search/providers/ProjectProvider.ts`:

```ts
import { formatRelativeTime, shortenPath } from '../../../core/format.js';
import { LABEL_FIELD, SearchService } from '../../SearchService.js';
import type { SearchHit, SearchProvider } from '../types.js';

/**
 * Projects, matched the same way the Projects panel matches them.
 *
 * Delegates to SearchService so there stays exactly one fuzzy
 * implementation in the codebase: a divergence here would mean the palette
 * and the panel disagree about what a query means.
 */
export const ProjectProvider: SearchProvider = {
  id: 'projects',
  kind: 'project',
  title: 'Projects',
  limit: 6,

  enabled: (context) => context.index.projects.length > 0,

  async search(query, context) {
    const { index } = context;
    return SearchService.filterProjects(index.projects, query, index.home).map(
      (result): SearchHit => {
        const project = result.item;
        const parts = [`${project.sessions} session${project.sessions === 1 ? '' : 's'}`];
        if (project.lastActivity > 0) {
          parts.push(formatRelativeTime(new Date(project.lastActivity * 1000)));
        }
        return {
          id: `project:${project.encoded}`,
          kind: 'project',
          title: project.orphaned ? project.encoded : shortenPath(project.path, index.home),
          highlights: result.highlights[LABEL_FIELD],
          subtitle: project.orphaned ? 'orphaned session folder' : project.path,
          meta: parts.join(' · '),
          score: result.score,
          target: { kind: 'project', encoded: project.encoded },
        };
      },
    );
  },
};
```

- [ ] **Step 4: Implement SessionProvider**

Create `src/services/search/providers/SessionProvider.ts`:

```ts
import { formatRelativeTime } from '../../../core/format.js';
import { LABEL_FIELD, SearchService } from '../../SearchService.js';
import type { SearchHit, SearchProvider } from '../types.js';

/**
 * Sessions from every project, live and archived.
 *
 * Project path stays out of the match fields, as it does in the panel.
 * Fuzzy subsequence matching against long absolute paths matches almost
 * anything, and globally a single high-session-count project would drown
 * every real title hit. The project is shown as context, not matched on.
 */
export const SessionProvider: SearchProvider = {
  id: 'sessions',
  kind: 'session',
  title: 'Sessions',
  limit: 12,

  enabled: (context) => context.index.sessions.length > 0,

  async search(query, context) {
    const { index } = context;
    return SearchService.filterSessions(index.sessions, index.metadata, query).map(
      (result): SearchHit => {
        const session = result.item;
        const parts = [formatRelativeTime(session.modifiedAt)];
        if (session.archived) parts.push('archived');
        return {
          id: `session:${session.file}`,
          kind: 'session',
          title: index.metadata.get(session.file)?.title ?? session.id,
          highlights: result.highlights[LABEL_FIELD],
          subtitle: index.projectLabels.get(session.encoded) ?? session.encoded,
          meta: parts.join(' · '),
          score: result.score,
          target: {
            kind: 'session',
            encoded: session.encoded,
            file: session.file,
            archived: session.archived,
          },
        };
      },
    );
  },
};
```

- [ ] **Step 5: Implement ConversationProvider**

Create `src/services/search/providers/ConversationProvider.ts`:

```ts
import type { SearchProvider } from '../types.js';

/**
 * Message search across conversation content.
 *
 * Disabled because no message index exists yet, so SearchEngine skips it
 * and the Messages group never renders. It ships registered so the shape
 * of the system is settled: nothing in SearchEngine, CommandPalette, or
 * useJumpTarget changes when it starts returning hits.
 *
 * Implementing it means indexing user prompts, assistant text, tool names,
 * and file paths keyed by session file, invalidated on size and mtime the
 * way MetadataCache is, then returning hits whose target carries the
 * record offset as `anchor`. That needs a full pass over every session
 * file, which is why it is not done inline: session files reach multiple
 * megabytes and the rest of the app deliberately never reads one whole.
 *
 * Returning partial results from the head/tail chunks the metadata parser
 * already reads was considered and rejected. That text is where session
 * titles come from, so those hits would duplicate the Sessions group.
 */
export const ConversationProvider: SearchProvider = {
  id: 'conversations',
  kind: 'message',
  title: 'Messages',
  limit: 10,

  enabled: () => false,

  async search() {
    return [];
  },
};
```

- [ ] **Step 6: Add the registration entry point**

Create `src/services/search/register.ts`:

```ts
import { SearchEngine } from './SearchEngine.js';
import { ConversationProvider } from './providers/ConversationProvider.js';
import { ProjectProvider } from './providers/ProjectProvider.js';
import { SessionProvider } from './providers/SessionProvider.js';

let registered = false;

/**
 * Wire the built-in providers into the engine.
 *
 * Kept out of SearchEngine so the engine does not import its own
 * providers: that would make it impossible to test the orchestration on
 * its own, and would couple adding a provider to editing the engine.
 */
export function registerDefaultProviders(): void {
  if (registered) return;
  registered = true;
  SearchEngine.register(ProjectProvider);
  SearchEngine.register(SessionProvider);
  SearchEngine.register(ConversationProvider);
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npm test`
Expected: PASS, 35 tests total.

- [ ] **Step 8: Commit**

```bash
git add src/services/search/providers src/services/search/register.ts
git commit -m "feat(search): add project, session and conversation providers"
```

---

### Task 7: Keybindings and jump planning

Moves the shared UI types out of `App.tsx` so `useJumpTarget` can import them without a cycle, adds the central keybinding table, and implements navigation.

**Files:**
- Create: `src/ui/keys.ts`
- Create: `src/ui/types.ts`
- Create: `src/ui/useJumpTarget.ts`
- Test: `src/ui/useJumpTarget.test.ts`

**Interfaces:**
- Consumes: `JumpTarget` from `../services/search/types.js`, `Project` from `../services/DiscoveryService.js`, `SessionEntry` from `../services/SessionService.js`, `DetailTab` from `./SessionDetail.js`.
- Produces:
  - `KEYS.commandPalette: { label: string; matches: (input: string, key: Key) => boolean }` from `src/ui/keys.js`.
  - `Focus`, `FOCUS_ORDER`, `ProjectItem` from `src/ui/types.js`.
  - `planJump(target: JumpTarget, items: ProjectItem[]): JumpPlan | null`, `pendingKey(encoded: string, archived: boolean): string`, `JumpPlan`, `JumpActions`, and `useJumpTarget(options): (target: JumpTarget) => void` from `src/ui/useJumpTarget.js`.

- [ ] **Step 1: Create the keybinding table**

Create `src/ui/keys.ts`:

```ts
import type { Key } from 'ink';

/**
 * Global keybindings, in one place so rebinding is a one-line change and
 * the footer label can never drift from what the handler actually accepts.
 */
export interface Binding {
  /** Shown in the footer and the help text. */
  label: string;
  matches: (input: string, key: Key) => boolean;
}

export const KEYS = {
  /**
   * Ink reports ctrl+k as input "k" with key.ctrl set. 0x0B is unclaimed
   * by terminal line discipline in raw mode, so nothing else wants it.
   *
   * The handler in App must test this before its vim-style navigation,
   * which treats a bare "k" as "move up" without checking key.ctrl.
   */
  commandPalette: {
    label: 'ctrl+k',
    matches: (input, key) => key.ctrl && input === 'k',
  },
} satisfies Record<string, Binding>;
```

- [ ] **Step 2: Move the shared UI types out of App**

Create `src/ui/types.ts`:

```ts
import type { Project } from '../services/DiscoveryService.js';

/** Which panel owns the keyboard. Tab cycles through them in this order. */
export type Focus = 'projects' | 'sessions' | 'details';

export const FOCUS_ORDER: Focus[] = ['projects', 'sessions', 'details'];

/** A row of the projects panel. "all" is a scope switch, not a project. */
export type ProjectItem = { kind: 'all' } | { kind: 'project'; project: Project };
```

In `src/ui/App.tsx`, delete the local `Focus`, `FOCUS_ORDER`, and `ProjectItem` declarations (currently lines 57-62) and import them instead:

```ts
import { FOCUS_ORDER, type Focus, type ProjectItem } from './types.js';
```

- [ ] **Step 3: Write the failing test**

Create `src/ui/useJumpTarget.test.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL. `tsc` errors with "Cannot find module './useJumpTarget.js'".

- [ ] **Step 5: Implement the planner and the hook**

Create `src/ui/useJumpTarget.ts`:

```ts
import { useCallback, useEffect, useState } from 'react';
import type { JumpTarget } from '../services/search/types.js';
import type { SessionEntry } from '../services/SessionService.js';
import type { DetailTab } from './SessionDetail.js';
import type { Focus, ProjectItem } from './types.js';

/**
 * Which list of sessions is currently loaded. Archived and live sessions
 * of one project are two different lists, so the toggle is part of the key
 * or a jump into the archive would resolve against the live list.
 */
export function pendingKey(encoded: string, archived: boolean): string {
  return `${encoded}|${archived}`;
}

export interface JumpPlan {
  projectIndex: number;
  /** null leaves the archived toggle alone. */
  showArchived: boolean | null;
  focus: Focus;
  detailTab: DetailTab | null;
  /** Set when a session still has to be selected once its list loads. */
  pending: { key: string; file: string } | null;
}

/**
 * Work out every state change a jump implies, with no React involved.
 *
 * Kept pure so the interesting part, which list ends up selected and
 * whether a second asynchronous step is needed, is testable without
 * mounting the app.
 */
export function planJump(target: JumpTarget, items: ProjectItem[]): JumpPlan | null {
  const projectIndex = items.findIndex(
    (item) => item.kind === 'project' && item.project.encoded === target.encoded,
  );
  if (projectIndex < 0) return null;

  if (target.kind === 'project') {
    return {
      projectIndex,
      showArchived: null,
      focus: 'projects',
      detailTab: null,
      pending: null,
    };
  }

  return {
    projectIndex,
    showArchived: target.archived,
    focus: target.kind === 'message' ? 'details' : 'sessions',
    detailTab: target.kind === 'message' ? 'conversation' : null,
    pending: { key: pendingKey(target.encoded, target.archived), file: target.file },
  };
}

/** The App state a jump has to drive. Every member is a stable setter. */
export interface JumpActions {
  setProjectIndex: (index: number) => void;
  setSessionIndex: (index: number) => void;
  setFocus: (focus: Focus) => void;
  setShowArchived: (value: boolean) => void;
  setProjectQuery: (query: string) => void;
  setSessionQuery: (query: string) => void;
  setSearching: (value: boolean) => void;
  setDetailTab: (tab: DetailTab) => void;
  setDetailScroll: (value: number) => void;
  setStatus: (status: string) => void;
}

/**
 * Turn a search result into a selection.
 *
 * The hard part is that selecting a project starts an asynchronous session
 * load, so the session a user picked does not exist in the list on the
 * render that selects its project. The jump is therefore two steps: apply
 * everything that is immediate, then hold the session file in `pending`
 * until the matching list has actually arrived.
 */
export function useJumpTarget(options: {
  /** Unfiltered project rows. Queries are cleared as part of the jump. */
  items: ProjectItem[];
  sessions: SessionEntry[];
  sessionsLoading: boolean;
  /** pendingKey of the session list currently loaded, or null. */
  loadedKey: string | null;
  actions: JumpActions;
}): (target: JumpTarget) => void {
  const { items, sessions, sessionsLoading, loadedKey, actions } = options;
  const [pending, setPending] = useState<{ key: string; file: string } | null>(null);

  const jumpTo = useCallback(
    (target: JumpTarget) => {
      const plan = planJump(target, items);
      if (!plan) {
        actions.setStatus('That result is no longer available.');
        return;
      }

      // A live filter on either panel could hide the very row being jumped
      // to, so both queries go before anything is selected.
      actions.setSearching(false);
      actions.setProjectQuery('');
      actions.setSessionQuery('');
      if (plan.showArchived !== null) actions.setShowArchived(plan.showArchived);
      actions.setProjectIndex(plan.projectIndex);
      if (plan.detailTab) {
        actions.setDetailTab(plan.detailTab);
        actions.setDetailScroll(0);
      }
      actions.setFocus(plan.focus);
      setPending(plan.pending);
      if (!plan.pending) actions.setSessionIndex(0);
    },
    [items, actions],
  );

  useEffect(() => {
    if (!pending || sessionsLoading) return;
    // Wait for the list that actually belongs to the target, otherwise the
    // previous project's sessions would resolve the jump against the wrong
    // set and land on an arbitrary row.
    if (loadedKey !== pending.key) return;

    const index = sessions.findIndex((session) => session.file === pending.file);
    if (index >= 0) actions.setSessionIndex(index);
    else actions.setStatus('That session is no longer available.');
    setPending(null);
  }, [pending, sessions, sessionsLoading, loadedKey, actions]);

  return jumpTo;
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test`
Expected: PASS, 41 tests total.

- [ ] **Step 7: Commit**

```bash
git add src/ui/keys.ts src/ui/types.ts src/ui/useJumpTarget.ts src/ui/useJumpTarget.test.ts src/ui/App.tsx
git commit -m "feat(ui): add keybinding table and command palette jump navigation"
```

---

### Task 8: Command palette overlay

**Files:**
- Modify: `src/ui/overlay/Modal.tsx:80-104` (`Modal` gains `borderStyle`)
- Modify: `src/ui/overlay/OverlayContext.tsx:45-51` (add `PaletteSpec` to the union)
- Modify: `src/ui/overlay/OverlayHost.tsx:20-34` (add the `palette` case)
- Create: `src/ui/overlay/CommandPalette.tsx`

**Interfaces:**
- Consumes: `SearchEngine`, `SearchIndexer`, `SearchHistory`, `registerDefaultProviders`, `resolveRowOffset`, `Modal`/`ModalLine`/`blankLine`/`textLine`/`useModalWidth`, `useOverlayInput`, `highlighted` from `../highlight.js`.
- Produces: `PaletteSpec { kind: 'palette'; onSelect: (target: JumpTarget) => void }` in the `OverlaySpec` union, and the `CommandPalette` component.

- [ ] **Step 1: Let Modal take a border style, and share its row padding**

In `src/ui/overlay/Modal.tsx`, change the import line:

```ts
import { Box, Text, type BoxProps } from 'ink';
```

Export the opaque-row primitives so a row that cannot use `ModalLine`'s flat segments still paints itself identically. Replace the `const BACKGROUND = 'black';` line with:

```ts
/**
 * The background every modal row paints, and the padding that carries it
 * to the frame's edge.
 *
 * Box padding would leave transparent gaps and the interface behind would
 * show through the dialog, so each row pads itself. Width is counted in
 * characters, which is correct only while every glyph inside the frame is
 * single-width.
 *
 * Exported because `CommandPalette` renders result rows as its own Text:
 * a highlighted title is per-character markup, which ModalLine's flat
 * segments cannot express. Sharing these two keeps the one thing that
 * must not diverge, the opaque row, in a single place.
 */
export const ROW_BACKGROUND = 'black';

export function rowPadding(width: number, used: number): string {
  return ' '.repeat(Math.max(0, width - used));
}
```

Then update `ModalLine` to use them:

```tsx
export function ModalLine({ segments, width }: { segments: Segment[]; width: number }) {
  const used = segments.reduce((total, segment) => total + segment.text.length, 0);
  return (
    <Text backgroundColor={ROW_BACKGROUND} wrap="truncate">
      {segments.map((segment, index) => (
        <Text
          key={index}
          color={segment.color}
          bold={segment.bold}
          dimColor={segment.dim}
          inverse={segment.inverse}
        >
          {segment.text}
        </Text>
      ))}
      {rowPadding(width, used)}
    </Text>
  );
}
```

Now change the `Modal` signature:

```tsx
export function Modal({
  borderColor = 'cyan',
  borderStyle = 'double',
  width,
  children,
}: {
  borderColor?: string;
  /** The palette uses a different frame so it never reads as a dialog. */
  borderStyle?: BoxProps['borderStyle'];
  /** Interior width in columns, excluding the border. */
  width: number;
  children: React.ReactNode;
}) {
  const { columns, rows } = useTerminalSize();
  return (
    <Box
      position="absolute"
      width={columns}
      height={rows}
      alignItems="center"
      justifyContent="center"
    >
      <Box flexDirection="column" borderStyle={borderStyle} borderColor={borderColor} width={width + 2}>
        {children}
      </Box>
    </Box>
  );
}
```

- [ ] **Step 2: Add the palette overlay spec**

In `src/ui/overlay/OverlayContext.tsx`, add the import and the spec, and extend the union:

```ts
import type { JumpTarget } from '../../services/search/types.js';
```

```ts
/**
 * The global command palette. It carries no data: the palette reads the
 * workspace index itself, and hands back only where to go.
 */
export interface PaletteSpec {
  kind: 'palette';
  onSelect: (target: JumpTarget) => void;
}

export type OverlaySpec =
  | ConfirmSpec
  | InputSpec
  | PickerSpec
  | OutputSpec
  | ActionsSpec
  | PaletteSpec;
```

- [ ] **Step 3: Render it from the host**

In `src/ui/overlay/OverlayHost.tsx`, add the import and the case:

```ts
import { CommandPalette } from './CommandPalette.js';
```

```tsx
          case 'palette':
            return <CommandPalette key={overlay.id} overlay={overlay} onClose={onClose} />;
```

- [ ] **Step 4: Implement the palette**

Create `src/ui/overlay/CommandPalette.tsx`:

```tsx
import React, { useEffect, useMemo, useState } from 'react';
import { Text } from 'ink';
import { SearchEngine } from '../../services/search/SearchEngine.js';
import { SearchHistory } from '../../services/search/SearchHistory.js';
import { SearchIndexer } from '../../services/search/SearchIndexer.js';
import type { SearchGroup, SearchHit, WorkspaceIndex } from '../../services/search/types.js';
import { fit, highlighted } from '../highlight.js';
import { useTerminalSize } from '../useTerminalSize.js';
import {
  Modal,
  ModalLine,
  ROW_BACKGROUND,
  blankLine,
  rowPadding,
  textLine,
  useModalWidth,
} from './Modal.js';
import { useOverlayInput, type PaletteSpec } from './OverlayContext.js';
import { resolveRowOffset } from './window.js';

/**
 * Global command palette.
 *
 * A "go to" system, not an action launcher: everything here navigates.
 * Results come from the in-memory workspace index, so opening this never
 * starts a scan and never waits for one. A build still in flight simply
 * means fewer results for a moment.
 *
 * Only single-width characters appear inside the frame. ModalLine pads its
 * opaque background using text.length, so a wide glyph would leave the
 * interface behind the palette showing through the row.
 */

/** One rendered line. A hit takes two of them when there is room. */
type PaletteRow =
  | { kind: 'spacer' }
  | { kind: 'header'; title: string }
  | { kind: 'hit'; hit: SearchHit; pick: number }
  | { kind: 'hitSub'; hit: SearchHit }
  | { kind: 'recent'; query: string; pick: number }
  | { kind: 'more'; count: number }
  | { kind: 'note'; text: string; dim?: boolean };

/** What enter does. Recent entries refine the query; hits navigate. */
type Selection = { kind: 'hit'; hit: SearchHit } | { kind: 'recent'; query: string };

const PLACEHOLDER = 'Search projects, sessions, messages…';
const TITLE_COLOR: Record<SearchHit['kind'], string> = {
  project: 'blue',
  session: 'cyan',
  message: 'magenta',
};

/**
 * A result row. Written as a Text rather than a ModalLine because the title
 * carries per-character highlight markup, which ModalLine's flat segments
 * cannot express. It paints itself with ModalLine's own ROW_BACKGROUND and
 * rowPadding, so the one property that must never diverge, an opaque row,
 * has a single implementation.
 */
function HitLine({
  hit,
  selected,
  width,
}: {
  hit: SearchHit;
  selected: boolean;
  width: number;
}) {
  const meta = hit.meta ?? '';
  const metaColumn = meta ? Math.min(meta.length, Math.max(0, width - 14)) : 0;
  const metaUsed = metaColumn ? metaColumn + 2 : 0;
  const titleWidth = Math.max(8, width - 6 - metaUsed);

  return (
    <Text backgroundColor={ROW_BACKGROUND} wrap="truncate">
      <Text color="green" bold>
        {selected ? '  > ' : '    '}
      </Text>
      <Text color={selected ? 'green' : TITLE_COLOR[hit.kind]} bold={selected}>
        {highlighted('', hit.title, hit.highlights, titleWidth)}
      </Text>
      {metaColumn ? <Text dimColor>{`  ${fit(meta.slice(0, metaColumn), metaColumn)}`}</Text> : null}
      {rowPadding(width, 4 + titleWidth + metaUsed)}
    </Text>
  );
}

export function CommandPalette({
  overlay,
  onClose,
}: {
  overlay: PaletteSpec & { id: number };
  onClose: () => void;
}) {
  const { columns, rows: terminalRows } = useTerminalSize();
  const [query, setQuery] = useState('');
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [index, setIndex] = useState(0);
  const [scroll, setScroll] = useState(0);
  const [snapshot, setSnapshot] = useState<WorkspaceIndex>(() => SearchIndexer.snapshot());

  // Re-render as the background build publishes more of the workspace.
  useEffect(() => SearchIndexer.subscribe(setSnapshot), []);

  useEffect(() => {
    if (!query.trim()) {
      setGroups([]);
      return;
    }
    let cancelled = false;
    SearchEngine.search(query, snapshot)
      .then((result) => {
        if (!cancelled) setGroups(result);
      })
      .catch(() => {
        if (!cancelled) setGroups([]);
      });
    return () => {
      cancelled = true;
    };
  }, [query, snapshot]);

  // Width follows the terminal but stays inside a readable band.
  const width = useModalWidth(Math.max(40, Math.min(100, Math.round(columns * 0.7))));
  const compact = terminalRows < 18;
  const tiny = terminalRows < 10;
  // border, input, two rules, footer, and the padding around the body.
  const chrome = tiny ? 5 : compact ? 7 : 9;
  const twoLine = !compact && width >= 50;

  const { rowList, picks } = useMemo(() => {
    const list: PaletteRow[] = [];
    const selections: Selection[] = [];
    const trimmed = query.trim();

    const pushHit = (hit: SearchHit) => {
      selections.push({ kind: 'hit', hit });
      list.push({ kind: 'hit', hit, pick: selections.length - 1 });
      if (twoLine && hit.subtitle) list.push({ kind: 'hitSub', hit });
    };

    if (!trimmed) {
      // History only changes on select, which closes the palette, so
      // reading it once per query state is enough.
      const recent = SearchHistory.list();
      if (recent.length === 0) {
        list.push({
          kind: 'note',
          text: 'Type to search every project and session in the workspace.',
          dim: true,
        });
      } else {
        list.push({ kind: 'header', title: 'Recent' });
        for (const entry of recent) {
          selections.push({ kind: 'recent', query: entry });
          list.push({ kind: 'recent', query: entry, pick: selections.length - 1 });
        }
      }
      return { rowList: list, picks: selections };
    }

    if (groups.length === 0) {
      list.push({ kind: 'note', text: 'No matching projects or sessions.' });
      list.push({ kind: 'spacer' });
      list.push({ kind: 'note', text: 'Press esc to close.', dim: true });
      if (snapshot.status !== 'ready' && snapshot.total > 0) {
        list.push({
          kind: 'note',
          text: `Still indexing ${snapshot.done}/${snapshot.total} sessions.`,
          dim: true,
        });
      }
      return { rowList: list, picks: selections };
    }

    groups.forEach((group, groupIndex) => {
      if (groupIndex > 0) list.push({ kind: 'spacer' });
      list.push({ kind: 'header', title: group.title });
      for (const hit of group.hits) pushHit(hit);
      if (group.total > group.hits.length) {
        list.push({ kind: 'more', count: group.total - group.hits.length });
      }
    });
    return { rowList: list, picks: selections };
  }, [query, groups, twoLine, snapshot.status, snapshot.done, snapshot.total]);

  const rowOfPick = useMemo(() => {
    const map: number[] = [];
    rowList.forEach((row, i) => {
      if (row.kind === 'hit' || row.kind === 'recent') map[row.pick] = i;
    });
    return map;
  }, [rowList]);

  const modalHeight = Math.max(tiny ? 6 : 8, Math.floor(terminalRows * 0.6));
  const viewport = Math.max(1, Math.min(rowList.length, modalHeight - chrome));

  const resolveOffset = (base: number, pick: number) => {
    const row = rowOfPick[pick] ?? 0;
    let next = resolveRowOffset({
      base,
      row,
      viewport,
      rowCount: rowList.length,
      headerAbove: rowList[row - 1]?.kind === 'header',
    });
    // Bring a hit's subtitle line along with it, unless the viewport is so
    // short that doing so would push the title itself off screen.
    if (viewport >= 2 && rowList[row + 1]?.kind === 'hitSub') {
      next = resolveRowOffset({
        base: next,
        row: row + 1,
        viewport,
        rowCount: rowList.length,
        headerAbove: false,
      });
    }
    return next;
  };

  const select = (next: number) => {
    const clamped = Math.max(0, Math.min(picks.length - 1, next));
    setIndex(clamped);
    setScroll((s) => resolveOffset(s, clamped));
  };

  useOverlayInput(overlay.id, (input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    // Arrows only. Every printable character has to reach the query, so
    // there is no j/k navigation here the way there is in the action menu.
    if (key.upArrow) {
      select(index - 1);
      return;
    }
    if (key.downArrow) {
      select(index + 1);
      return;
    }
    if (key.pageUp) {
      select(index - viewport);
      return;
    }
    if (key.pageDown) {
      select(index + viewport);
      return;
    }
    if (key.return) {
      const choice = picks[index];
      if (!choice) return;
      if (choice.kind === 'recent') {
        setQuery(choice.query);
        setIndex(0);
        setScroll(0);
        return;
      }
      // Only a query that produced a jump is worth remembering.
      SearchHistory.record(query);
      onClose();
      overlay.onSelect(choice.hit.target);
      return;
    }
    if (key.ctrl && (input === 'u' || input === 'w')) {
      setQuery('');
      setIndex(0);
      setScroll(0);
      return;
    }
    if (key.backspace || key.delete) {
      setQuery((q) => q.slice(0, -1));
      setIndex(0);
      setScroll(0);
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      setQuery((q) => q + input);
      setIndex(0);
      setScroll(0);
    }
  });

  const offset = resolveOffset(scroll, index);
  const rule = (
    <ModalLine
      width={width}
      segments={[{ text: `  ${'─'.repeat(Math.max(0, width - 4))}`, dim: true }]}
    />
  );

  const renderRow = (row: PaletteRow, key: number) => {
    switch (row.kind) {
      case 'spacer':
        return <React.Fragment key={key}>{blankLine(width)}</React.Fragment>;

      case 'header':
        return (
          <ModalLine
            key={key}
            width={width}
            segments={[{ text: '  ' }, { text: row.title.toUpperCase(), bold: true, dim: true }]}
          />
        );

      case 'note':
        return (
          <React.Fragment key={key}>{textLine(row.text, width, { dim: row.dim })}</React.Fragment>
        );

      case 'more':
        return (
          <ModalLine
            key={key}
            width={width}
            segments={[{ text: `      +${row.count} more`, dim: true }]}
          />
        );

      case 'hitSub': {
        const text = (row.hit.subtitle ?? '').slice(0, Math.max(0, width - 8));
        return (
          <ModalLine key={key} width={width} segments={[{ text: `      ${text}`, dim: true }]} />
        );
      }

      case 'recent': {
        const selected = row.pick === index;
        return (
          <ModalLine
            key={key}
            width={width}
            segments={[
              { text: selected ? '  > ' : '    ', color: 'green', bold: true },
              { text: row.query.slice(0, Math.max(0, width - 6)), bold: selected },
            ]}
          />
        );
      }

      case 'hit':
        return <HitLine key={key} hit={row.hit} selected={row.pick === index} width={width} />;
    }
  };

  const counter = rowList.length > viewport && picks.length > 0 ? `${index + 1}/${picks.length}` : '';
  const indexing =
    snapshot.status !== 'ready' && snapshot.total > 0
      ? `indexing ${snapshot.done}/${snapshot.total}`
      : '';
  const separator = '  ·  ';
  const trailing = [indexing, counter].filter(Boolean).join(separator);
  const room = Math.max(0, width - 4 - (trailing ? trailing.length + separator.length : 0));
  const long = 'enter jumps to the result, esc closes';
  const short = 'enter jump, esc close';
  const hint = long.length <= room ? long : short.length <= room ? short : '';
  const footer = hint && trailing ? `${hint}${separator}${trailing}` : hint || trailing;

  const visibleQuery =
    query.length > width - 8 ? `…${query.slice(-(width - 9))}` : query;

  return (
    <Modal borderColor="blue" borderStyle="round" width={width}>
      {compact ? null : blankLine(width)}
      <ModalLine
        width={width}
        segments={[
          { text: '  ' },
          { text: '> ', color: 'blue', bold: true },
          query
            ? { text: visibleQuery, bold: true }
            : { text: PLACEHOLDER.slice(0, Math.max(0, width - 6)), dim: true },
          { text: ' ', inverse: true },
        ]}
      />
      {tiny ? null : rule}

      {rowList.slice(offset, offset + viewport).map((row, i) => renderRow(row, offset + i))}

      {tiny ? null : rule}
      {textLine(footer, width, { dim: true })}
      {compact ? null : blankLine(width)}
    </Modal>
  );
}
```

- [ ] **Step 5: Build and check types**

Run: `npm test`
Expected: PASS, 41 tests, and `tsc` reports no errors.

- [ ] **Step 6: Commit**

```bash
git add src/ui/overlay/Modal.tsx src/ui/overlay/OverlayContext.tsx src/ui/overlay/OverlayHost.tsx src/ui/overlay/CommandPalette.tsx
git commit -m "feat(ui): add the global command palette overlay"
```

---

### Task 9: Wire the palette into the app

**Files:**
- Modify: `src/ui/App.tsx`

**Interfaces:**
- Consumes: `KEYS` from `./keys.js`, `SearchIndexer` from `../services/search/SearchIndexer.js`, `registerDefaultProviders` from `../services/search/register.js`, `useJumpTarget`/`pendingKey` from `./useJumpTarget.js`.
- Produces: nothing new. This task connects existing pieces.

- [ ] **Step 1: Add the imports and register providers once**

In `src/ui/App.tsx`, add:

```ts
import { SearchIndexer } from '../services/search/SearchIndexer.js';
import { registerDefaultProviders } from '../services/search/register.js';
import { KEYS } from './keys.js';
import { pendingKey, useJumpTarget, type JumpActions } from './useJumpTarget.js';
```

Below the imports, at module scope:

```ts
// Providers are process-wide, so registration happens once at load rather
// than on every mount of the palette.
registerDefaultProviders();
```

- [ ] **Step 2: Track which session list is loaded**

Add the state next to the other session state:

```ts
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
```

In the sessions loading effect, inside `.then(async (list) => { ... })`, immediately after `setSessions(list);` add:

```ts
        setLoadedKey(
          selectedItem?.kind === 'project'
            ? pendingKey(selectedItem.project.encoded, showArchived)
            : null,
        );
```

- [ ] **Step 3: Warm the index from the existing discovery effect**

In the discovery effect, replace the `.then((list) => { ... })` body with:

```ts
      .then((list) => {
        if (cancelled) return;
        list.sort((a, b) => b.lastActivity - a.lastActivity);
        setProjects(list);
        // Reuse the discovery that just ran instead of scanning twice, and
        // build in the background so opening the palette never waits.
        SearchIndexer.invalidate();
        void SearchIndexer.warm(list);
      })
```

- [ ] **Step 4: Build the jump handler**

After the `categories` memo and before the keyboard section, add:

```ts
  // Setters from useState are stable, so this object never has to change
  // and the jump effect does not re-run on every render.
  const jumpActions = useMemo<JumpActions>(
    () => ({
      setProjectIndex,
      setSessionIndex,
      setFocus,
      setShowArchived,
      setProjectQuery,
      setSessionQuery,
      setSearching,
      setDetailTab,
      setDetailScroll,
      setStatus,
    }),
    [],
  );

  const jumpTo = useJumpTarget({
    items: allProjectItems,
    sessions: visibleSessions,
    sessionsLoading,
    loadedKey,
    actions: jumpActions,
  });

  const openPalette = useCallback(
    () => open({ kind: 'palette', onSelect: jumpTo }),
    [open, jumpTo],
  );
```

- [ ] **Step 5: Bind the key**

In `useAppInput`, make the palette check the very first statement in the handler, above the `if (searching) {` block:

```ts
    (input, key) => {
      // Before everything, including the search branch: the palette is
      // global, and the navigation below treats a bare "k" as "move up"
      // without checking key.ctrl.
      if (KEYS.commandPalette.matches(input, key)) {
        openPalette();
        return;
      }

      // While typing a query the panel keeps arrow navigation, so a match
      // can be selected without leaving search mode.
      if (searching) {
```

- [ ] **Step 6: Surface it in the footer and the help**

In the `bindings` arrays, insert the palette entry after the `['/', 'search']` pair in the `projects` and `sessions` lists, and after `['1-4', 'tab']` in the `details` list:

```ts
          [KEYS.commandPalette.label, 'go to'],
```

In `HELP_TEXT`, add to the Navigation block after the `/` line:

```
  ctrl+k         command palette: search every project and session
```

And add a section after "Details panel":

```
Command palette (ctrl+k)
  Searches the whole workspace, not just the focused list. Results are
  grouped into Projects and Sessions; enter jumps straight to one, which
  selects its project, loads its sessions, and highlights it. Recent
  searches appear when the input is empty. This is navigation only:
  operations stay in the action palette (x).
```

- [ ] **Step 7: Build and verify types**

Run: `npm test`
Expected: PASS, 41 tests, `tsc` clean.

- [ ] **Step 8: Verify the palette by hand against a throwaway data directory**

```bash
npm run build
export LAZY_CLAUDE_CLAUDE_DIR=$(mktemp -d)
mkdir -p "$LAZY_CLAUDE_CLAUDE_DIR/projects/-tmp-demo-alpha" "$LAZY_CLAUDE_CLAUDE_DIR/projects/-tmp-demo-beta"
mkdir -p /tmp/demo/alpha /tmp/demo/beta
printf '%s\n' '{"type":"user","cwd":"/tmp/demo/alpha","timestamp":"2026-01-01T00:00:00Z","message":{"content":"Build the palette"}}' > "$LAZY_CLAUDE_CLAUDE_DIR/projects/-tmp-demo-alpha/11111111-0000-0000-0000-000000000001.jsonl"
printf '%s\n' '{"type":"user","cwd":"/tmp/demo/beta","timestamp":"2026-01-02T00:00:00Z","message":{"content":"Fix the migration issue"}}' > "$LAZY_CLAUDE_CLAUDE_DIR/projects/-tmp-demo-beta/22222222-0000-0000-0000-000000000002.jsonl"
node dist/cli.js
```

Walk the checklist and confirm each one:

- `ctrl+k` opens the palette from Projects, from Sessions, and from Details.
- `/` then typing, then `ctrl+k`, still opens the palette, and the list cursor did not move.
- Typing `migration` shows a Sessions group and no Messages group.
- `enter` on that result selects the beta project, highlights the session, and clears both panel queries.
- Reopening with `ctrl+k` shows `Recent` containing `migration`, and the input is empty.
- `enter` on the recent entry fills the input and searches without navigating.
- Typing `zzzzz` shows "No matching projects or sessions." and "Press esc to close."
- `esc` closes the palette and leaves the panels where they were.

Then resize the terminal to roughly 100x40, 80x24, 60x16, and 50x9 and confirm the palette stays inside the frame at each size.

Clean up:

```bash
rm -rf "$LAZY_CLAUDE_CLAUDE_DIR" /tmp/demo
unset LAZY_CLAUDE_CLAUDE_DIR
```

- [ ] **Step 9: Commit**

```bash
git add src/ui/App.tsx
git commit -m "feat(ui): open the command palette with ctrl+k and jump to results"
```

---

### Task 10: Document the search layer

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: everything built above.
- Produces: nothing.

- [ ] **Step 1: Update the commands block**

In `CLAUDE.md`, add to the commands block:

```bash
npm test          # tsc, then node --test over the compiled output
```

And change the sentence below it from "There is no test runner, linter, or formatter configured. `tsc` under `strict` is the only automated check, so run `npm run build` after changes." to:

```
There is no linter or formatter configured. Tests use Node's built-in
runner with no dependencies: sources and `*.test.ts` files sit side by side
under `src/`, and `npm test` compiles then runs `node --test dist`. Run it
after changes; `tsc` under `strict` is still the type check.

Tests cover the pure layers only: ranking, the search engine, the workspace
indexer, providers, jump planning, and overlay windowing. Ink components
are verified by building and driving the real TUI.
```

- [ ] **Step 2: Document the search layer**

Add this section to `CLAUDE.md` after "### Overlay system":

```markdown
### Global search and the command palette

`ctrl+k` opens a palette that searches every project and session, separate
from the per-panel `/` search. It navigates and nothing else; operations
stay in the action palette (`x`).

`src/services/search/` holds the whole engine and imports no UI:

- `SearchIndexer` owns data. One in-memory `WorkspaceIndex` covering every
  project and every session, live and archived, built in the background
  from the discovery App already ran. Opening the palette must never
  trigger indexing and never wait for it; it searches whatever is ready.
  Builds are generation-stamped so a rescan mid-build discards the stale
  result instead of publishing over the fresh one.
- `SearchEngine` owns orchestration: the `SearchContext`, the
  `AbortController` that cancels a superseded query, per-provider failure
  isolation, group caps, and `GROUP_ORDER`. Group ordering lives here, not
  on providers, so the same query always puts the same kind of result in
  the same place.
- Providers own matching, one domain each, and are stateless and mutually
  independent. They delegate to `SearchService` so there stays exactly one
  fuzzy implementation.

Adding a searchable entity means writing a provider, registering it in
`register.ts`, adding its `ResultKind` to `GROUP_ORDER`, and, if it
navigates somewhere new, a `JumpTarget` variant plus a case in
`useJumpTarget`. Nothing in `CommandPalette` or `SearchEngine` changes.

`ConversationProvider` ships registered and disabled. Turning message
search on is implementing that one file.

Ranking tiers live in `FilterService` and are shared: exact beats prefix
beats substring beats subsequence, with the fuzzy score breaking ties
inside a tier. The panel searches get this too.

Jumping is two steps, because selecting a project starts an asynchronous
session load. `useJumpTarget` applies what is immediate, then holds the
target session file until the matching list arrives, keyed on
`encoded|archived` so a jump into the archive never resolves against the
live list.

All global keybindings live in `src/ui/keys.ts`. The palette check must run
before everything else in `useAppInput`, including the search branch: the
navigation below it treats a bare `k` as "move up" without checking
`key.ctrl`.
```

- [ ] **Step 3: Verify nothing else drifted**

Run: `npm test`
Expected: PASS, 41 tests.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document the global search layer and command palette"
```

---

## Self-Review

**Spec coverage.** Every section of the design maps to a task: activation and `keys.ts` (7, 9), the search layer types and provider contract (3), `SearchIndexer` and warm-up (4), `SearchEngine` with `GROUP_ORDER` and abort (5), the three providers (6), ranking tiers (1), palette sizing, rows, recent searches and empty states (8), shared windowing (2), jump behaviour (7, 9), performance (4, 5), verification (9), and documentation (10). The spec's "no CLI command" and "actions stay in the x menu" are honoured by omission: no task touches `src/cli/`, and no task adds an action provider.

**Known trade-offs recorded here rather than left implicit.**

- Result rows use `HitLine`, a bespoke `Text`, rather than `ModalLine`, because `ModalLine` takes flat segments and `highlighted` returns per-character markup. `ModalLine`'s public shape is deliberately unchanged: instead, `ROW_BACKGROUND` and `rowPadding` are exported from `Modal.tsx` and both rows use them, so the opaque-row behaviour has one implementation while each row type keeps its own content rendering.
- During warm-up, sessions whose metadata has not been parsed yet fall back to their id as a title, so they match on id rather than title until phase 3 reaches them. The footer says `indexing n/total` while that is true.
- `SearchHistory.list()` is read inside a `useMemo` that does not depend on it. This is safe only because history changes on select, which closes the palette. If a future change records history without closing, that memo needs the dependency.
- Footer bindings are getting long. If `HelpBar` overflows at narrow widths, drop `['?', 'help']` from the sessions list before dropping the palette entry.
