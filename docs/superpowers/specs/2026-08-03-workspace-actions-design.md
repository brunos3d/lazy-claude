# Workspace actions and view state

Status: approved, ready to implement.

Adds a fourth category to the command palette (Actions), introduces sortable
and filterable workspace state, and moves global operations out of the
contextual action menu.

## The split between the two surfaces

Lazy Claude ends up with two command surfaces, and the rule that separates
them has to be mechanical or both fill with the same entries.

- `x` acts on the highlighted project or session. Remove the selection and
  the entry has nothing to run against.
- `ctrl+k` Actions acts on the workspace or on how the workspace is
  displayed. It reads no selection.

Applying that rule moves seven entries out of the `x` menu: backup manager,
unpack archive, health check, diagnostics, rescan, refresh metadata, and
prune orphans. None of them look at the highlighted row. The `x` menu loses
its Maintenance category as a result; check integrity folds into Session and
repair references into Project, leaving Session, Project, and Dangerous.

Repair references is the one entry that lives in both. `startRepair` already
behaves differently depending on context: it targets the selected project
when that project's directory is missing, and otherwise opens a picker over
every broken project. Those are two different operations sharing one
function, so both surfaces get an entry.

## What was cut from the proposal

The proposal listed roughly forty candidate actions. Twenty five survive.

**The Navigation category, all eight entries.** "Jump to largest session" is
"sort by size" plus "move the cursor to the top", except the sort leaves the
workspace in a state that explains itself and the jump leaves the cursor on
a row with no visible reason for being there. Sorting subsumes the whole
category, and it does it as durable state rather than a one shot.

**Nine of the twelve quick filters.** "Projects with broken references" and
"projects missing on disk" are the same predicate: `!exists && !orphaned`,
which is what `startRepair` already uses. "Recently modified", "recently
created", "very old sessions", "projects with the highest storage usage",
and "large sessions" are sorts, not filters; a filter that hides everything
below a threshold is strictly worse than an ordering that puts the same rows
on top and keeps the rest reachable. "Projects with backups" has no meaning
in the data model: backups are snapshots of the single global
`history.jsonl`, not a per project artifact. That leaves missing, orphaned,
and empty.

**Seven of the eight statistics entries.** Largest sessions, storage usage,
archived counts, and average size are rows of one report. They become one
action and one overlay.

**A configurable size threshold.** There is no configuration system, and
adding one to serve a filter that sorting already covers is not worth it.

## Workspace view state

```ts
// src/services/view/types.ts
export type SortDirection = 'asc' | 'desc';
export interface SessionSort { field: 'modified' | 'size' | 'title'; direction: SortDirection }
export interface ProjectSort { field: 'activity' | 'sessions' | 'size' | 'name'; direction: SortDirection }
export type ProjectFilter = 'none' | 'missing' | 'orphaned' | 'empty';

export interface WorkspaceView {
  sessionSort: SessionSort;
  projectSort: ProjectSort;
  projectFilter: ProjectFilter;
}
```

`ViewService` (`src/services/view/ViewService.ts`) holds the only
implementation of each sort and each filter predicate, plus the named option
tables:

```ts
export const SESSION_SORTS: SortOption<SessionSort>[]  // 6 entries
export const PROJECT_SORTS: SortOption<ProjectSort>[]  // 5 entries
export const PROJECT_FILTERS: FilterOption[]           // 3 entries plus none
```

The sidebar sort popup and the palette's sorting actions are both generated
from those tables, so a new sort is one row and appears in both places. That
is the "exactly one implementation of each sort" requirement, made
structural rather than a convention to remember.

Session sorting by title needs metadata, which arrives asynchronously after
the session list. `sortSessions` takes the metadata map and falls back to
the session id, which is what the rows already display while metadata loads.

State lives in `App.tsx` as a single `WorkspaceView` value. It does not
persist across restarts. There is no configuration file today, and a
sort silently surviving a restart is a worse first impression than a
predictable default.

### Where it applies

The project list becomes three stages, in this order:

1. `ViewService.filterProjects(projects, view.projectFilter)`
2. `ViewService.sortProjects(...)` when there is no query
3. `SearchService.filterProjects(...)` when there is a query

A query replaces the sort rather than composing with it: relevance ranking
is itself an ordering, and applying a sort on top of ranked results throws
the ranking away. The same holds for sessions.

### The jump index hazard

`useJumpTarget` finds a project index with `planJump` and hands it to
`setProjectIndex`, but `projectIndex` indexes the *rendered* rows. Today
that only works because a jump clears both search queries first, which makes
the rendered rows identical to the full list on the next render.

A filter breaks that invariant, and clearing the filter inside `jumpTo` does
not fix it: `planJump` runs against the list of the current render, which
still has the filter applied, so a jump to a filtered out project would
report "no longer available".

The fix is to keep the list `useJumpTarget` plans against free of both the
query and the filter, while still applying the sort:

- `sortedProjectItems` = `[{ kind: 'all' }, ...sortProjects(projects, sort)]`.
  This is what `useJumpTarget` receives.
- The rendered rows apply the filter and then the query on top.
- `jumpTo` clears the queries and resets the filter, so the rendered rows
  equal `sortedProjectItems` on the next render and the index is valid.

`planJump` matches on `encoded`, so reordering by sort is harmless. Resetting
the filter needs a new member on `JumpActions`.

## Actions architecture

Mirrors the search provider layer, one directory over.

```ts
// src/services/actions/types.ts
export type ActionCategory = 'sort' | 'filter' | 'workspace' | 'insight';

export interface WorkspaceAction {
  id: string;
  title: string;
  subtitle?: string;
  /** Extra words that should find this action. Never displayed. */
  keywords?: string[];
  category: ActionCategory;
  /** Reflects current view state, rendered as a check. */
  active?: boolean;
  danger?: boolean;
  run: () => void;
}

export interface ActionProvider {
  id: string;
  category: ActionCategory;
  title: string;               // section header, for example "Sorting"
  list(context: ActionContext): WorkspaceAction[];
}
```

The category lives on the provider and the registry stamps it onto every
action, the way `SearchProvider.kind` works. An action cannot then claim a
group its provider does not own.

`ActionContext` carries the current view, a view setter, and the workspace
operation handlers `App` already builds (`refresh`, `rescanMetadata`,
`runDiagnostics`, `healthCheck`, `startPrune`, `startBackups`,
`startUnpack`, `startRepair`, `showStatistics`, `toggleArchived`). It is the
same shape as `ActionContext` in `ui/actions/registry.ts`, but for global
operations, and it lives in services rather than UI because nothing in it is
Ink specific.

Providers, one file each under `src/services/actions/providers/`:

| Provider | Category | Count |
| --- | --- | --- |
| `SortActions` | Sorting | 11 |
| `FilterActions` | Filters | 5 |
| `WorkspaceActions` | Workspace | 8 |
| `InsightActions` | Statistics | 1 |

`ActionRegistry.list(context)` concatenates providers in registration order,
stamping the category. Registration happens in
`src/services/actions/register.ts`, called once at load like
`registerDefaultProviders`.

### The action inventory

Sorting (11): sessions by most recent, oldest, largest, smallest, title A to
Z, title Z to A; projects by recently active, least recently active, most
sessions, largest, name A to Z. "Least recently active" earns its place: it
is how you find the stale projects worth deleting, which is a real use of
this tool and awkward otherwise.

Filters (5): show archived sessions (a toggle that reflects state), only
projects missing on disk, only orphaned projects, only empty projects, clear
filters. The clear entry is listed only when something is active.

Workspace (8): rescan workspace, refresh session metadata, repair broken
references, run health check, run diagnostics, history backups, unpack
archive, prune orphaned folders (dangerous).

Statistics (1): workspace statistics.

Keywords carry the searches named in the proposal. "largest" reaches both
size sorts and the statistics report; "repair" reaches repair references,
health check, and the missing projects filter; "archive" reaches the
archived toggle, unpack archive, and statistics.

## Bridging actions into the palette

`ActionSearchProvider` (`src/services/search/providers/ActionProvider.ts`)
is a normal `SearchProvider` over `context.actions`. It ranks through
`SearchService.filterActions`, which builds a `SearchDocument` with the
title at weight 1 and highlighted, the subtitle at 0.5, and the keywords
joined at 0.4 and not highlighted. `FilterService` already returns every
document in caller order for an empty query, so browsing and searching are
the same code path.

Three changes to the search layer make this fit:

**`SelectTarget`.** `SearchHit.target` becomes
`JumpTarget | { kind: 'action'; id: string }`. `PaletteSpec.onSelect` takes
the union, and `App` dispatches: an action id runs the matching action, and
everything else goes to `jumpTo` unchanged. The palette stays free of
execution semantics, which is what keeps "the palette selects, App decides"
true.

**`SearchContext.actions`.** The context is documented as the extension
point for new shared inputs, so it grows an `actions: WorkspaceAction[]`
field and no provider signature changes. `SearchEngine.search` takes the
actions alongside the index. The palette receives them from `PaletteSpec`,
built fresh each time the palette opens, exactly as `ActionsSpec` carries
categories today.

**`SearchProvider.browsable`.** `SearchEngine.search` returns `[]` for an
empty query. With `browsable: true`, a provider runs on an empty query too.
Only `ActionSearchProvider` sets it: running the project and session
providers on an empty query would dump the entire workspace into a tab that
duplicates the sidebar.

**`SearchHit.section`.** Optional header text that groups rows inside one
tab. The palette already renders `header` rows and `resolveRowOffset`
already accounts for a header above the cursor, so this is a row builder
change only.

## Palette changes

The empty query view has to change. An Actions tab nobody can see until they
guess a matching word defeats the point, so the tab bar must appear before
anything is typed.

Recent searches become a group. The palette prepends a synthetic
`{ kind: 'recent' }` group when the query is empty and history exists, so
the empty state renders as tabs: `Recent (3)` `Actions (25)`. Nearly all the
machinery for this exists: `RECENT_KEY` is already a per tab state key, the
`Selection` union already has a `recent` variant, and the row renderer
already draws recent rows. What changes is that they route through the same
group and tab path as everything else instead of a separate branch.

The active tab defaults to Recent when history exists, Actions otherwise.
Seeing the tab is the discovery affordance; a returning user still lands on
their recent searches.

Action rows render with a leading check for `active` entries, red for
`danger`, and no subtitle line unless the two line mode is on. The footer
reads "enter runs" when the active tab holds actions and "enter jumps"
otherwise.

Selecting an action closes the palette before running it. Several actions
open their own overlay, and running before closing would leave the palette
underneath.

## Sidebar sorting

`s` opens a sort popup for whichever list has focus. It reuses `PickerSpec`,
so no new overlay kind: options come from `SESSION_SORTS` or
`PROJECT_SORTS`, and the active one carries a check.

The active sort shows on the right of the panel's search row, dim, as
`↓ recent` or `↑ title`. `SearchRow` already has a `flexGrow` spacer for it.
An active project filter shows in the panel title: `Projects (7 of 40 ·
missing)`, so a filter can never be silently on.

`esc` gains a step: clear the query, then clear the filter, then walk back
up the focus hierarchy. Invisible state that survives an escape is how a
filtered list starts looking like a bug.

## Statistics

`StatsService` computes a `WorkspaceStats` from projects and sessions, with
no metadata and no new file reads, and formats it to text. The TUI passes
the in memory index snapshot, so the overlay opens instantly and shows a
note when the index is still building. A `lazyclaude stats` CLI command
gathers the same inputs from disk and prints the same text, which is what
`CLAUDE.md` asks for when an operation is added.

The report: project counts (total, missing, orphaned, empty), session counts
(live, archived), total and average session size, the five largest sessions,
the five largest projects, and the oldest and newest session timestamps.

## Testing

The pure layers get tests, matching what the project already covers:

- `ViewService`: every sort orders correctly and is stable, direction
  reverses, title sort falls back to the session id when metadata is
  missing, each filter predicate selects the right projects.
- `ActionRegistry`: the category is stamped from the provider, providers
  concatenate in order, the clear filters entry appears only when a filter
  is active, and the archived toggle reflects state.
- `SearchService.filterActions`: keyword matches rank below title matches,
  an empty query returns every action in order.
- `SearchEngine`: an empty query returns only browsable providers, a
  non-empty query returns all enabled providers, and the actions group sorts
  into its place in `GROUP_ORDER`.
- `StatsService`: counts and aggregates on a fixture workspace.
- `planJump`: unchanged behaviour against a sorted project list.

Ink components stay verified by building and driving the real TUI.

## Order of work

1. `ViewService` plus tests. No UI.
2. Sidebar wiring: view state in `App`, the three stage pipeline, the jump
   index fix, the `s` popup, the indicators, `esc`.
3. Actions layer plus tests: types, registry, four providers, register.
4. Search layer: `SelectTarget`, `browsable`, `section`,
   `SearchContext.actions`, `filterActions`, `ActionSearchProvider`.
5. Palette: recent as a group, tabs on empty query, section headers, action
   rows, footer.
6. `x` menu split, help text, `HelpBar`.
7. `StatsService`, the overlay, and the CLI command.

Steps 1 and 2 ship a working sidebar sort on their own, which keeps the
branch reviewable if the palette work runs long.
