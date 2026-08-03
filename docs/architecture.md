# Architecture

Notes for anyone changing the code. The [README](../README.md) covers using Lazy Claude; this file covers how it works inside.

## Layers

Three layers, strictly separated.

| Layer           | Contents                                                                                              |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| `src/core/`     | Pure primitives: path encoding, JSONL chunk readers, fuzzy matching, filesystem moves, the undo journal |
| `src/services/` | All business logic and every read of Claude Code's on-disk format                                       |
| `src/ui/`       | Ink components                                                                                          |
| `src/cli/`      | Flag parsing, prompts, one function per command                                                         |

The UI and the CLI are two front ends over the same services. Neither parses session records or touches the filesystem directly. Adding an operation means writing a service function, a command in `src/cli/commands.ts`, and an entry in `src/ui/actions/registry.ts`.

```
src/
  cli.tsx                entry point, usage text, resume handoff
  cli/
    args.ts              flag parsing
    prompt.ts            interactive confirmation and selection
    commands.ts          one function per CLI command
  core/
    paths.ts             data directory resolution and path encoding
    fuzzy.ts             fzf-style subsequence matching and scoring
    jsonl.ts             head/tail chunk readers and record streaming
    fsx.ts               move/merge/copy with cross-device fallbacks
    history.ts           history.jsonl read/rewrite/remove/append
    nested.ts            nested project folder detection
    journal.ts           undo journal for rollback
    format.ts            size, time, duration and token formatting
  services/
    DiscoveryService.ts        project discovery
    SessionService.ts          session list/archive/restore/delete/validate
    SessionMetadataService.ts  titles and per-session metadata, cached
    ConversationService.ts     statistics, timeline and preview parsing
    MetadataCache.ts           versioned on-disk cache
    WorkspaceResolver.ts       cwd to project, for `lazyclaude .`
    FilterService.ts           ranked filtering over documents
    SearchService.ts           what projects, sessions and actions are searchable by
    ViewService.ts             sorts, filters, and the named sort tables
    StatsService.ts            workspace counts, storage and rankings
    ProjectService.ts          project info and removal
    MoveService.ts             journaled project moves
    RepairService.ts           broken reference detection and relinking
    BackupService.ts           history.jsonl backup create/list/restore/delete
    PackService.ts             .claudepack pack/unpack
    LauncherService.ts         resume handoff to Claude Code, launch modes
    DiagnosticsService.ts      health check, prune, doctor
    relocate.ts                shared folder-rename and history-rewrite logic
    search/                    the global search engine
      SearchIndexer.ts         the in-memory workspace index
      SearchEngine.ts          orchestration, group ordering, cancellation
      providers/               one per searchable entity
    actions/                   workspace actions, the global command surface
      ActionRegistry.ts        provider composition and category order
      providers/               sorting, filters, workspace ops, statistics
  ui/                    Ink components: App, panels, rows, detail tabs
    keys.ts              global keybindings
    actions/registry.ts  the contextual action menu, from the selection
    overlay/
      OverlayContext.tsx overlay stack and the input-gating hooks
      OverlayHost.tsx    renders the stack as the last root sibling
      Modal.tsx          opaque modal frame
      dialogs.tsx        confirm, input, picker, output, action menu
      CommandPalette.tsx the ctrl+k palette: navigation and workspace actions
```

## Claude Code's on-disk format

Sessions live at `~/.claude/projects/<encoded-project-path>/<session-id>.jsonl`, with a `history.jsonl` index at the root of `~/.claude`.

The encoding replaces every character outside `[a-zA-Z0-9]` with `-`, verified against real data: `/home/user/.claude-mem` becomes `-home-user--claude-mem`. It is lossy, so Lazy Claude never decodes a folder name back to a path. Matching always goes forward, from a known path to `encodeProjectPath(path)`. Unknown folders are resolved through the `cwd` values recorded inside their session files, and folders with no resolvable path are reported as orphaned.

Nested projects are the sharp edge. `/a/foo-bar` and `/a/foo` share an encoded prefix, so a name match alone cannot tell a sub-project from a sibling. `src/core/nested.ts` treats a folder as nested only when a history entry under the source encodes exactly to its name, or when its session files record a `cwd` inside the source.

Lazy Claude's own state lives under `~/.claude/lazy-claude/`: `archive/<encoded-project>/` for archived sessions, deliberately outside `projects/` so Claude Code stops listing them, and `cache/` for metadata caches.

The data directory resolves in this order: `LAZY_CLAUDE_CLAUDE_DIR`, then `CLAUDE_CONFIG_DIR` (the same variable Claude Code respects), then `~/.claude`.

## Mutations are journaled

`MoveService`, `RepairService` and `PackService` build a `Journal` (`src/core/journal.ts`). Every mutating step records its inverse, and a failure rolls back completed steps in reverse order. Any new multi-step filesystem operation must follow this.

They also back up `history.jsonl` first unless `--no-backup`, and support `-n/--dry-run` by returning the planned steps instead of executing them.

## Session parsing and caching

Session files reach multiple megabytes and the `ai-title` record sits near the end. Two services own every record shape:

- `SessionMetadataService` reads cheap facts (title, branch, cwd, version) by pulling a chunk from each end of the file via `core/jsonl.ts`, never the whole thing. Backed by `MetadataCache`.
- `ConversationService` does the single deep pass that produces statistics, timeline, preview and file activity together. Everything on the inspector tabs comes from that one pass.

`MetadataCache` is a versioned on-disk cache invalidated by file size and mtime. Bump the `version` constructor argument whenever the producing parser changes, or upgraded builds will serve values computed by old logic.

A first scan of around 800 sessions takes about a quarter of a second; later launches read from the cache.

## Overlay system

Dialogs are data, not screens. `OverlayProvider` holds a stack, `OverlayHost` renders it as the final sibling of a `position="relative"` root in `App.tsx` (Ink composites siblings in order, which is what puts dialogs on top), and `Modal` paints every interior line as a full-width `Text` with a background colour so the UI behind cannot bleed through.

Input gating is central and non-negotiable: `useOverlayInput(id, ...)` fires only for the top overlay, `useAppInput(...)` only when the stack is empty. Never call Ink's `useInput` directly in app or dialog components.

A new dialog type means adding a spec to the `OverlaySpec` union in `OverlayContext.tsx` and a case in `OverlayHost`.

## Global search

`src/services/search/` holds the whole engine and imports no UI.

- `SearchIndexer` owns data. One in-memory `WorkspaceIndex` covering every project and session, live and archived, built in the background from the discovery the app already ran. Opening the palette never triggers indexing and never waits for it; it searches whatever is ready. Builds are generation-stamped so a rescan mid-build discards the stale result, and each build owns an `AbortSignal` so an abandoned build stops reading the workspace.
- `SearchEngine` owns orchestration: the `SearchContext`, the `AbortController` that cancels a superseded query, per-provider failure isolation, and `GROUP_ORDER`. Group ordering lives here, not on providers, so the same query always puts the same kind of result in the same place. Nothing is capped, because each group gets its own scrollable tab and a ceiling would only make results past it unreachable.
- Providers own matching, one domain each, and are stateless and mutually independent. They delegate to `SearchService` so there stays exactly one fuzzy implementation.

A provider can set `browsable`, which makes it run on an empty query so its tab is visible before anything is typed. Only `ActionProvider` does: browsing every project would duplicate the sidebar in a tab.

Adding a searchable entity means writing a provider, registering it in `register.ts`, adding its `ResultKind` to `GROUP_ORDER`, and, if it navigates somewhere new, a `JumpTarget` variant plus a case in `useJumpTarget`. Nothing in `CommandPalette` or `SearchEngine` changes.

`ConversationProvider` ships registered and disabled. Turning message search on is implementing that one file.

Jumping is two steps, because selecting a project starts an asynchronous session load. `useJumpTarget` applies what is immediate, then holds the target session file until the matching list arrives, keyed on `encoded|archived` so a jump into the archive never resolves against the live list.

Ranking tiers live in `FilterService` and are shared with the panel searches: exact beats prefix beats substring beats subsequence, with the fuzzy score breaking ties inside a tier.

Tab order is fixed by `GROUP_ORDER`, but which tab opens focused is not. The palette focuses the group holding the highest scoring hit, because subsequence matching means a long project path matches almost any word and `repair` would otherwise land on a project that merely contains those letters in order. Switching tabs pins the choice until the palette closes.

## Two command surfaces

`x` and `ctrl+k` divide by one mechanical rule. `x` acts on the highlighted project or session, so removing the selection leaves its entries with nothing to run against. The palette's Actions tab acts on the workspace or on how it is displayed, and reads no selection. Without a rule that sharp, both surfaces drift into listing everything the program can do.

`src/services/actions/` mirrors the search provider layer: `ActionProvider` returns `ActionSpec`s for one category, `ActionRegistry` concatenates providers and stamps the category on so an action cannot claim a section its provider does not own, and `CATEGORY_ORDER` decides presentation the way `GROUP_ORDER` does for search. `ActionContext` carries the current view, a view setter, and the workspace handlers `App` already builds.

Actions reach the palette through `ActionProvider` in `src/services/search/providers/`, ranked by `SearchService.filterActions` over title, subtitle and keywords. Keywords carry the searches nobody would guess the command name for: `largest` reaches both size sorts and the statistics report, `broken` reaches repair.

Selecting an action does not run it in the palette. `SelectTarget` carries the action id, `onSelect` hands it back, and `App` dispatches, which is what keeps the palette free of every operation's semantics.

## Sorting and filtering

Sorting and filtering are workspace state, not one-off commands: a chosen order holds until something else is chosen. `WorkspaceView` lives in `App.tsx`; `ViewService` holds the only implementation of each sort and each filter predicate, plus the `SESSION_SORTS`, `PROJECT_SORTS` and `PROJECT_FILTERS` tables that the sidebar popup (`s`) and the palette's sorting actions both read. A new sort is one row in a table and reaches both surfaces already wired.

Lists apply filter, then either the query ranking or the sort. A query replaces the sort rather than composing with it, because relevance ranking is itself an ordering and re-sorting would throw it away.

The project filter forced one subtlety. `planJump` returns an index into the full project list while `projectIndex` reads the rendered rows, so a jump clears both queries and the filter, which makes the two agree on the next render. Sorting is safe to leave applied because `planJump` matches on `encoded`. That is why `JumpActions` carries `clearProjectFilter`.

Neither the sort nor the filter persists across restarts, and both are visible while active: the sort on the right of each panel's search row, the filter in the panel title, cleared by `esc`.

## UI layout

`App.tsx` owns all TUI state. Focus is a three-value hierarchy (`projects`, `sessions`, `details`). Sessions always belong to the highlighted project regardless of which panel has focus, and the centre panel follows focus. Each list keeps its own search query.

Panels are sized from `useTerminalSize()` and pass explicit `height`/`width` down. Ink does not clip overflow, so components take a height and window their own content rather than relying on the parent to cut them off. `dialogs.tsx` shows the pattern: content-aware width, viewport windowing with a scroll offset, and tiered chrome overhead for small terminals.

All global keybindings live in `src/ui/keys.ts`. The palette check runs before everything else in `useAppInput`, including the search branch, because the navigation below it treats a bare `k` as "move up" without checking `key.ctrl`.

## Resume handoff

Resuming does not wrap Claude Code. `LauncherService.request(plan)` stores a validated plan, Ink unmounts, `cli.tsx` leaves the alternate screen, and only then does it `spawnSync` `claude --resume` with stdio inherited.

Validation (missing binary, moved project directory, deleted or archived session file) happens before the interface exits, so failures surface as dialogs rather than a broken terminal. Launch modes are data in `LAUNCH_MODES`; a new mode is an entry there, not a UI change.

## Terminal title

The TUI switches to the alternate screen buffer and sets the window title with OSC 0. The bracketing CSI 22/23 push and pop the terminal's own title stack, so quitting restores whatever the shell had set. Windows consoles ignore the escape sequences, so `process.title` is set as well.

## Tests

`npm test` compiles with `tsc` and then runs `node --test 'dist/**/*.test.js'`. Sources and `*.test.ts` files sit side by side under `src/`.

The quoted glob is deliberate. Node 22 stopped recursively scanning a bare directory passed to `--test`, so `node --test dist` fails, and Node resolves the quoted pattern itself rather than the shell. Running the tests therefore needs Node 21 or newer, while the published CLI still supports the Node 18 floor in `engines`.

Tests cover the pure layers only: ranking, the search engine, the workspace indexer, providers, jump planning and overlay windowing. Ink components are verified by building and driving the real TUI.

After every build, `scripts/chmod-bin.mjs` chmods `dist/cli.js` to 0755. tsc writes 0644, which breaks an already-linked `lazyclaude`. Do not drop that step from the build script.

## Conventions

- ESM throughout (`"type": "module"`, `module: NodeNext`). Relative imports carry the `.js` extension, including from `.tsx` files.
- Runtime dependencies are `ink`, `react` and `tar` only. No shell-outs, no extra CLI tools.
- Path handling is separator-aware and cross-device moves fall back to copy-and-delete (`core/fsx.ts`). Windows is a design target even though it is untested.
- Comments explain why a constraint exists, not what the code does.
