# Command Palette

Status: approved, not yet implemented
Date: 2026-08-03

A global search and navigation overlay for the Lazy Claude TUI, opened with
`ctrl+k`. Type a few characters, pick a project or session, and land on it
with the panels already focused and selected correctly.

This does not replace the per-panel `/` search. That search stays local to
the focused list. The palette searches the whole workspace.

## Scope

In scope:

- A centered overlay with a search input and grouped, scrollable results.
- Global fuzzy search across projects and sessions, live and archived.
- A provider architecture so new searchable entities are added without
  touching the palette UI or the engine.
- A `ConversationProvider` that is registered but returns nothing, so the
  Messages group is prepared without shipping a message index.
- Automatic navigation to the selected result.

Out of scope, deliberately:

- Running actions. Those stay in the `x` action menu. The palette is a
  "Go To" system, not a command executor. Mixing navigation and actions
  makes the interaction less predictable. An `ActionProvider` can be
  registered later if it earns its place.
- Any CLI command. The palette is a TUI navigation feature. The search
  engine stays an internal service used only by the palette. If a CLI use
  case appears later, the engine is already shaped to expose it.
- Message indexing itself. See "Conversation search" below.

## Activation

`ctrl+k`. Ink reports it as `input === 'k'` with `key.ctrl === true`, and
0x0B is unclaimed by terminal line discipline in raw mode.

All global bindings move into `src/ui/keys.ts` as a matcher plus a display
label:

```ts
export interface Binding {
  label: string;
  matches: (input: string, key: Key) => boolean;
}

export const KEYS = {
  commandPalette: { label: 'ctrl+k', matches: (i, k) => k.ctrl && i === 'k' },
} satisfies Record<string, Binding>;
```

`App.tsx` tests the binding as the first statement in `useAppInput`, before
the `searching` branch, so the palette opens even while a panel query is
being typed.

That ordering is required, not cosmetic. The existing handler treats
`input === 'k'` as "move up" without checking `key.ctrl`, so without an
early return `ctrl+k` would both scroll the list and open the palette.

Rebinding later means editing one line in `keys.ts`. The label flows from
there into the footer and the help text.

## Search layer

Lives in `src/services/search/`. No file in it imports Ink or React.

### Types

`types.ts` defines the vocabulary shared by the engine, the providers, and
the palette.

```ts
export type ResultKind = 'project' | 'session' | 'message';

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

export type JumpTarget =
  | { kind: 'project'; encoded: string }
  | { kind: 'session'; encoded: string; file: string; archived: boolean }
  | { kind: 'message'; encoded: string; file: string; archived: boolean; anchor?: number };
```

`encoded` is the join key throughout. It is the only stable identifier
shared by `Project`, `SessionEntry`, and the archive tree. Nothing in the
palette decodes a folder name back to a path, per the rule in `CLAUDE.md`.

`SearchHit` stays generic on purpose. A provider that needs extra data puts
it in `payload`, which the engine and the palette treat as opaque. Resist
adding provider-specific optional fields to the shared type: the reason it
works for three kinds of result is that it describes how a row is displayed
and where it navigates, nothing more.

### Provider contract

```ts
export interface SearchContext {
  index: WorkspaceIndex;
  signal: AbortSignal;
}

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

Providers are stateless. They receive a context and return hits.

A provider describes what it provides, not where it appears. `limit` stays
on the provider because how many results are useful is intrinsic to the
domain. Group ordering does not, because it is a presentation decision that
belongs to the engine:

```ts
const GROUP_ORDER: ResultKind[] = ['project', 'session', 'message'];
```

Providers never depend on one another. Each searches only its own domain
and returns independent results. No provider reads another's output,
imports another provider, or assumes one has already run. This is what lets
the engine run them in parallel and what keeps adding Files, Diagnostics,
Notes, or Bookmarks a local change.

`search` is async by contract even though project and session search
resolve from memory. A future provider backed by SQLite, an FTS index, or
a file scan slots in without changing the engine or the palette.

`enabled` takes the same context as `search`, so the two methods stay
symmetric and a provider that inspects the index to decide availability has
the same shape as one that queries it.

`SearchContext` is the single extension point. Adding `home` for path
shortening, a clock, or a cancellation deadline is a field on the context
and changes zero provider signatures.

### WorkspaceIndex and SearchIndexer

`SearchIndexer.ts` holds one in-memory snapshot of the workspace.

```ts
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
```

The singleton exposes `warm(projects)`, `invalidate()`, and
`subscribe(listener)`.

Warm-up runs in the background as soon as `DiscoveryService.discoverProjects()`
resolves inside App's existing effect. Three phases:

1. Projects come from that existing call. Discovery does not run twice.
2. `listAllSessions()` and `listAllArchivedSessions()`.
3. `SessionMetadataService.getMany` over the combined list, publishing
   progress between batches so a cold cache streams instead of stalling.

The palette is usable during phase 3. Projects are already searchable and
the footer shows `indexing 1240/3800`.

Opening the palette must never trigger indexing and must never wait for it
to finish. It searches whatever portion of the index is available at that
moment and re-renders as more arrives. Warm-up is owned by App's discovery
effect, not by the overlay. A palette that blocks on a cold cache is the
failure mode this whole layer exists to avoid.

`App.refresh()` calls `invalidate()`, so rescan, archive, restore, delete,
move, and unpack all reindex.

This requires one change to an existing service: `SessionMetadataService.getMany`
gains an optional `onProgress` callback, fired once per internal batch, and
saves the cache once at the end rather than per batch. Its existing
`CONCURRENCY = 12` batching already yields to the event loop between
batches, which is what keeps Ink responsive while the warm-up runs.

### SearchEngine

`SearchEngine.ts` owns the request lifecycle.

- `register(provider)` at module init.
- `search(query, index)` builds the `SearchContext`, owns the
  `AbortController`, and aborts the previous run when a new query arrives.
- Runs enabled providers in parallel with `Promise.all`.
- Drops groups with zero hits, so empty groups never render.
- Sorts groups by `GROUP_ORDER` and caps each to `provider.limit`, keeping
  the true count in `SearchGroup.total`.

Providers never construct a context or an abort controller themselves.

### Providers

`ProjectProvider` delegates to `SearchService.filterProjects`. Title is the
shortened path, subtitle is the absolute path, meta is the session count
and relative last activity.

`SessionProvider` delegates to `SearchService.filterSessions` over the whole
index. Title is the session title, subtitle is the owning project label,
meta is relative time plus an `archived` tag when applicable.

Both delegate rather than reimplement, so there stays exactly one fuzzy
implementation in the codebase.

`SessionProvider` keeps the existing exclusion of project path from session
match fields. The reasoning in `SearchService` gets stronger globally, not
weaker: fuzzy subsequence matching against long absolute paths matches
almost anything, and a single high-session-count project would otherwise
drown every real title hit.

`ConversationProvider` ships written and registered. `enabled()` returns
false because no message index exists, `search()` returns `[]`, and the
Messages header never renders. A comment states what implementing it
requires.

No placeholder rows, and no indexing of session preview text as a stand-in.
Preview text is largely what the session title already derives from, so
those hits would duplicate the Sessions group and mislead.

## Ranking

`core/fuzzy.ts` ranks fzf-style but does not guarantee that an exact match
beats a strong scattered one. `FilterService` gains tier classification,
comparing the query to each field value case-insensitively:

| Tier | Condition           |
| ---- | ------------------- |
| 3    | exact equality      |
| 2    | prefix              |
| 1    | substring           |
| 0    | subsequence only    |

Final score is `tier * TIER_WEIGHT + fuzzyScore * field.weight`, with
`TIER_WEIGHT = 10000`. The highest reachable fuzzy score is bounded by
pattern length times the per-character constants in `core/fuzzy.ts`, so
10000 keeps tiers strictly separated for any realistic query.

This lands in `FilterService`, so it is shared. The palette and both panel
searches improve together. Within a tier the existing original-index
tie-break survives, which is what preserves recency ordering in lists that
arrive sorted by recency.

## Palette UI

A new `PaletteSpec` joins the `OverlaySpec` union, carrying only
`onSelect(target: JumpTarget)`. The palette owns its query state and
subscribes to `SearchIndexer` for progress.

Sizing follows the terminal. Width is `columns * 0.7` clamped to `[40, 100]`
and then through `useModalWidth`. Body height is about `rows * 0.6`. Chrome
degrades through the same compact and tiny tiers `ActionMenu` uses, and
below a threshold hits collapse from two lines to one.

Rows flatten to `header | hit | more | spacer`. The cursor only lands on
`hit`; headers, `+N more` lines, and spacers are skipped. Windowing keeps a
group's header on screen alongside its first visible hit.

Per-provider limits: Projects 6, Sessions 12, Conversation 10.

Group order is fixed by `GROUP_ORDER`: Projects, then Sessions, then
Messages. The same
query always puts the same kind of result in the same place, which is what
makes the palette usable from muscle memory. Each group is capped and shows
a dim `+N more` line when truncated. Narrowing is done by typing, not by
expanding a group.

Visual separation from the action dialogs: `borderStyle="round"` with a blue
accent instead of the cyan double border, and a tall input row with a `❯`
prompt and an inverse cursor block. `Modal` currently hardcodes
`borderStyle="double"`, so it gains a `borderStyle` prop.

Keys: up and down move through hits, enter jumps, esc closes, typing
updates results live.

The palette always opens with an empty query. Nothing carries over from the
previous open, so the first keystroke always starts a fresh search.

### Recent searches

`src/services/search/SearchHistory.ts` keeps the last 10 successful queries
for the lifetime of the process. Nothing is written to disk.

A query counts as successful when the user selects a result while it is
active. Queries that were typed and abandoned are not recorded, which is
what keeps the list free of half-typed prefixes.

Recording moves an existing entry to the front rather than duplicating it,
so the list holds 10 distinct queries ordered by most recent use.

With an empty query the palette renders the history as a single group under
a `Recent` header:

```text
  Recent
  > Move billing project
    Repair references
    Agenda Zap
    Docker
```

Selecting a recent entry sets the query to that text and searches again. It
does not navigate anywhere. This is the one row kind whose enter behaviour
is not a jump, so it is a distinct row type in the flattened list rather
than a `SearchHit` with a fake target.

History lives in a service, not in palette state, because the palette
unmounts every time it closes.

### Empty state

When a query matches nothing, the body shows a single centered block:

```text
  No matching projects or sessions.

  Press esc to close.
```

When the index is still building, the empty state adds a third line naming
the progress, so a user who searches for a session during warm-up learns
that more results are still coming rather than concluding it does not exist.

With an empty query and no history yet, the body shows a short hint naming
what is searchable instead of the no-match text.

### Shared windowing

`ActionMenu` already carries row-window math. `CommandPalette` needs the
same. Extract it to `src/ui/overlay/window.ts`: the offset calculation plus
the rule that pulls a preceding header into view.

The extraction is deliberately narrow. `ActionMenu` loses its local
`resolveOffset` and calls the helper with the arguments it already computes.
Its `MenuRow` type, `renderRow`, column-width logic, chrome tiers, and
footer stay exactly as they are. This is infrastructure extraction, not a
redesign of `dialogs.tsx`, which has pending work.

## Jump behavior

Selecting a result navigates the interface. The user never has to locate
the item again.

The sharp edge is asynchrony. Setting `projectIndex` starts a session load,
so the target session does not exist in `visibleSessions` on the same
render. A `pendingJump` state bridges the gap.

Selecting a session hit:

1. Clear `projectQuery` and `sessionQuery`. A stale filter can hide the
   target.
2. Set `showArchived` to match the hit, since the index covers both.
3. Set `projectIndex` against the unfiltered `allProjectItems`. With the
   query cleared in the same batch, the filtered and unfiltered lists agree.
4. Record `pendingJump: { encoded, file }`.
5. Set focus to `sessions`.

An effect resolves the pending jump once `sessionsLoading` is false and the
loaded list belongs to the expected `encoded`, then sets `sessionIndex`. If
the file has vanished since indexing, it clears the pending jump and reports
that in the status bar rather than landing somewhere arbitrary.

A project hit does steps 1 and 3 and sets focus to `projects`. The sessions
panel follows automatically, because sessions already track the highlighted
project regardless of focus.

A message hit does everything a session hit does, then sets `detailTab` to
`conversation` and focus to `details`. The `anchor` field on the target is
reserved for scrolling to the matching message once a message index exists.

This lives in `src/ui/useJumpTarget.ts`, not inline in `App.tsx`. The hook
owns `pendingJump` and its resolution effect and returns `jumpTo(target)`.
`App.tsx` is already 1215 lines, and this is roughly 60 lines of subtle
async state transition that deserves to be readable on its own.

## Performance

No filesystem scan happens when the palette opens. Every query runs against
the in-memory `WorkspaceIndex`.

`fuzzyMatch` rejects non-matching candidates in a single O(n) probe before
the dynamic programming pass, so only real candidates pay the expensive
path. With thousands of sessions across three fields each, a keystroke stays
in low tens of milliseconds.

Per-group caps bound rendering work regardless of how many items match.

## Verification

The TUI needs a TTY, and the search layer now has no CLI entry point by
design, so verification uses a temporary pty-driven harness under the
scratchpad directory. The harness is not committed and not shipped.

Checks:

- `npm run build` passes under `strict`. This is the only automated check
  the project has.
- Palette opens on `ctrl+k` from every focus state, including while a panel
  query is being typed, and `ctrl+k` does not also move the list cursor.
- Ranking tiers: an exact project name outranks a fuzzy match on a longer
  path.
- Empty groups are omitted, and the Messages group never appears.
- Reopening the palette starts with an empty query, with no carry-over from
  the previous open.
- A query that produced a jump appears under `Recent` on the next open. A
  query that was typed and abandoned does not. Re-running an existing entry
  moves it to the front instead of duplicating it, and the list caps at 10.
- Selecting a recent entry fills the input and searches without navigating.
- The no-match empty state renders, and during warm-up it also names the
  indexing progress.
- Opening the palette on a cold cache returns project results immediately
  and never blocks.
- Jump to a session in a different project selects the right project, the
  right session, and clears both queries.
- Jump to an archived session flips the archived toggle.
- Jump to a session whose file was deleted after indexing reports a status
  message instead of selecting the wrong row.
- Palette renders correctly at several terminal sizes, including the tiny
  tier, following the approach already used for `ActionMenu`.

Exercise anything destructive against a throwaway `LAZY_CLAUDE_CLAUDE_DIR`.

## Files

New:

- `src/ui/keys.ts`
- `src/services/search/types.ts`
- `src/services/search/SearchIndexer.ts`
- `src/services/search/SearchEngine.ts`
- `src/services/search/SearchHistory.ts`
- `src/services/search/providers/ProjectProvider.ts`
- `src/services/search/providers/SessionProvider.ts`
- `src/services/search/providers/ConversationProvider.ts`
- `src/ui/overlay/CommandPalette.tsx`
- `src/ui/overlay/window.ts`
- `src/ui/useJumpTarget.ts`

Modified:

- `src/services/FilterService.ts`, ranking tiers
- `src/services/SessionMetadataService.ts`, `getMany` progress callback
- `src/ui/overlay/OverlayContext.tsx`, `PaletteSpec` in the union
- `src/ui/overlay/OverlayHost.tsx`, the new case
- `src/ui/overlay/Modal.tsx`, `borderStyle` prop
- `src/ui/overlay/dialogs.tsx`, `ActionMenu` uses the shared windowing helper
- `src/ui/App.tsx`, binding, indexer warm-up, `jumpTo` wiring, footer, help
- `CLAUDE.md`, document the search layer and the palette

## Adding a provider later

The intended path, for reference when the conversation index arrives:

1. Write the provider implementing `SearchProvider`.
2. Register it with `SearchEngine` and add its `ResultKind` to
   `GROUP_ORDER` at the position the group should render.
3. If it navigates somewhere new, add a `JumpTarget` variant plus a case in
   `useJumpTarget`.

No change to `CommandPalette`, `SearchEngine`, or `SearchIndexer`.
