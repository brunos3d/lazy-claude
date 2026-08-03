# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build     # tsc + restore the executable bit on dist/cli.js
npm run dev       # tsc --watch
npm start         # node dist/cli.js
npm test          # tsc, then node --test over the compiled output
npm link          # expose `lazyclaude` (and the `lazy-claude`, `lazy-claude-tui`, `lzc` aliases) globally
```

There is no linter or formatter configured. Tests use Node's built-in runner with no dependencies: sources and `*.test.ts` files sit side by side under `src/`, and `npm test` compiles then runs `node --test 'dist/**/*.test.js'`. Run it after changes; `tsc` under `strict` is still the type check.

The quoted glob is deliberate. Node 22 stopped recursively scanning a bare directory passed to `--test`, so `node --test dist` now fails, and Node resolves the quoted pattern itself rather than the shell. Running the tests therefore needs Node 21 or newer, while the published CLI still supports the Node 18 floor in `engines`.

Tests cover the pure layers only: ranking, the search engine, the workspace indexer, providers, jump planning, and overlay windowing. Ink components are verified by building and driving the real TUI.

After every build, `scripts/chmod-bin.mjs` chmods `dist/cli.js` to 0755. tsc writes 0644, which breaks an already-linked `lazy-claude`/`lzc`. Do not drop that step from the build script.

## Running against real data

The TUI reads and mutates `~/.claude`. Set `LAZY_CLAUDE_CLAUDE_DIR` to a throwaway directory before exercising anything destructive (move, repair, prune, remove, unpack). Resolution order in `src/core/paths.ts` is `LAZY_CLAUDE_CLAUDE_DIR`, then `CLAUDE_CONFIG_DIR`, then `~/.claude`.

The TUI needs a TTY and exits with an error otherwise. Use the CLI commands (`lazy-claude list`, `sessions`, `show <id>`, `info --json`) to inspect behavior non-interactively, or drive the TUI through a pty.

Other env vars: `LAZY_CLAUDE_CLAUDE_BIN` overrides the path to the `claude` executable used when resuming.

## Architecture

Three layers, strictly separated:

- `src/core/` - pure primitives: path encoding, JSONL chunk readers, fuzzy matching, filesystem move/copy with cross-device fallback, the undo journal, formatters.
- `src/services/` - all business logic and every read of Claude Code's on-disk format. Stateless module objects or singletons.
- `src/ui/` (Ink/React) and `src/cli/` - two front ends over the same services. Neither parses session records or touches the filesystem directly.

Adding an operation means: a service function, a command in `src/cli/commands.ts`, and an entry in one of the two action surfaces. Resist putting logic in either front end.

### Claude Code's on-disk format

Sessions live at `~/.claude/projects/<encoded-project-path>/<session-id>.jsonl`, plus a `history.jsonl` index at the root. The encoding replaces every character outside `[a-zA-Z0-9]` with `-`, which is lossy. Never decode a folder name back to a path. Matching always goes forward from a known path to `encodeProjectPath(path)`; unknown folders are resolved through `cwd` values recorded inside their session files.

Nested projects are the sharp edge: `/a/foo-bar` and `/a/foo` share an encoded prefix, so a name match alone cannot tell a sub-project from a sibling. `src/core/nested.ts` treats a folder as nested only when a history entry under the source encodes exactly to its name, or when its session files record a `cwd` inside the source.

Lazy Claude's own state lives under `~/.claude/lazy-claude/`: `archive/<encoded-project>/` for archived sessions (deliberately outside `projects/` so Claude Code stops listing them) and `cache/` for metadata caches.

### Mutations are journaled

`MoveService`, `RepairService`, and `PackService` build a `Journal` (`src/core/journal.ts`): every mutating step records its inverse, and a failure rolls back completed steps in reverse order. Any new multi-step filesystem operation must follow this. They also back up `history.jsonl` first unless `--no-backup`, and support `-n/--dry-run` by returning the planned steps instead of executing them.

### Session parsing and caching

Session files reach multiple megabytes and the `ai-title` record sits near the end. Two services own every record shape:

- `SessionMetadataService` - cheap facts (title, branch). Reads a chunk from each end of the file via `core/jsonl.ts`, never the whole thing. Backed by `MetadataCache`.
- `ConversationService` - the single deep pass that produces statistics, timeline, preview, and file activity together. Everything on the detail tabs comes from that one pass.

`MetadataCache` is a versioned on-disk cache invalidated by file size and mtime. Bump the `version` constructor argument whenever the producing parser changes, or upgraded builds will serve values computed by old logic.

### Overlay system

Dialogs are data, not screens. `OverlayProvider` holds a stack; `OverlayHost` renders it as the final sibling of a `position="relative"` root in `App.tsx` (Ink composites siblings in order, which is what puts dialogs on top); `Modal` paints every interior line as a full-width `Text` with a background color so the UI behind cannot bleed through.

Input gating is central and non-negotiable: `useOverlayInput(id, ...)` fires only for the top overlay, `useAppInput(...)` only when the stack is empty. Never call Ink's `useInput` directly in app or dialog components.

A new dialog type means adding a spec to the `OverlaySpec` union in `OverlayContext.tsx` and a case in `OverlayHost`.

### The two command surfaces

`x` and `ctrl+k` divide by one mechanical rule, and it has to stay mechanical or both fill with the same entries.

- `x` (`src/ui/actions/registry.ts`) acts on the highlighted project or session. Remove the selection and the entry has nothing to run against.
- `ctrl+k` Actions (`src/services/actions/`) acts on the workspace or on how it is displayed, and reads no selection.

`src/services/actions/` mirrors the search provider layer: a provider owns one category and returns `ActionSpec`s, `ActionRegistry` concatenates providers and stamps the category on so an action cannot claim a section its provider does not own, and `CATEGORY_ORDER` decides presentation the way `GROUP_ORDER` does for search. `ActionContext` carries the current view, a view setter, and the workspace handlers App already builds.

Selecting an action does not run it in the palette. `SelectTarget` carries the action id, `onSelect` hands it back, and App dispatches. That is what keeps the palette free of every operation's semantics.

Repair is the one entry in both surfaces, because `startRepair` targets the selected project when its directory is missing and otherwise opens a picker over every broken project.

### Sorting and filtering are workspace state

A chosen order holds until something else is chosen. `WorkspaceView` lives in `App.tsx`; `ViewService` holds the only implementation of each sort and each filter predicate, plus the `SESSION_SORTS`, `PROJECT_SORTS` and `PROJECT_FILTERS` tables that the sidebar popup (`s`) and the palette's sorting actions both read. A new sort is one row in a table and reaches both surfaces already wired.

Lists apply filter, then either the query ranking or the sort. A query replaces the sort rather than composing with it: relevance ranking is itself an ordering, and re-sorting would throw it away.

The project filter forced one subtlety. `planJump` returns an index into the full project list while `projectIndex` reads the rendered rows, so a jump clears both queries and the filter, which makes the two agree on the next render. Sorting is safe to leave applied because `planJump` matches on `encoded`. That is why `JumpActions` carries `clearProjectFilter`.

Neither the sort nor the filter persists across restarts, and both stay visible while active: the sort on the right of each panel's search row, the filter in the panel title, cleared by `esc`.

### Global search and the command palette

`ctrl+k` opens a palette that searches every project and session and runs workspace actions, separate from the per-panel `/` search.

`src/services/search/` holds the whole engine and imports no UI:

- `SearchIndexer` owns data. One in-memory `WorkspaceIndex` covering every project and every session, live and archived, built in the background from the discovery App already ran. Opening the palette must never trigger indexing and never wait for it; it searches whatever is ready. Builds are generation-stamped so a rescan mid-build discards the stale result instead of publishing over the fresh one. The stamp only suppresses publishing, so each build also owns an `AbortSignal` threaded into `SessionMetadataService.getMany`; `abort()` and `invalidate()` trip it. Without that, an abandoned build keeps reading the workspace, and since nothing calls `process.exit()` a quit sits there waiting for it.
- `SearchEngine` owns orchestration: the `SearchContext`, the `AbortController` that cancels a superseded query, per-provider failure isolation, and `GROUP_ORDER`. Group ordering lives here, not on providers, so the same query always puts the same kind of result in the same place. Nothing is capped: the palette gives each group its own scrollable tab, so a ceiling would only make results past it unreachable.
- Providers own matching, one domain each, and are stateless and mutually independent. They delegate to `SearchService` so there stays exactly one fuzzy implementation.

Adding a searchable entity means writing a provider, registering it in `register.ts`, adding its `ResultKind` to `GROUP_ORDER`, and, if it navigates somewhere new, a `JumpTarget` variant plus a case in `useJumpTarget`. Nothing in `CommandPalette` or `SearchEngine` changes.

`ConversationProvider` ships registered and disabled. Turning message search on is implementing that one file.

A provider can set `browsable`, which makes it run on an empty query so its tab is visible before anything is typed. Only `ActionProvider` does: browsing every project would duplicate the sidebar in a tab, while an action nobody can see until they guess a matching word is not discoverable, and discovery is the reason the tab exists.

The palette shows one category at a time, chosen by a tab bar under the input, and the active tab owns the whole result area. Tabs are derived from the groups the engine returns, so a category with no hits simply has no tab and the user can never land on an empty one. That is also why a disabled provider needs no special case. Recent searches are a tab too, built by the palette rather than a provider, since they refine the query instead of selecting anything. Tab and shift+tab cycle categories, and each tab keeps its own cursor and scroll offset so switching back and forth is lossless.

Tab order is fixed by `GROUP_ORDER`, but which tab opens focused is not: the palette focuses the group holding the highest scoring hit. Subsequence matching means a long project path matches almost any word, so `repair` would otherwise land on a project that merely contains those letters in order. Switching tabs pins the choice until the palette closes.

Ranking tiers live in `FilterService` and are shared: exact beats prefix beats substring beats subsequence, with the fuzzy score breaking ties inside a tier. The panel searches get this too.

Jumping is two steps, because selecting a project starts an asynchronous session load. `useJumpTarget` applies what is immediate, then holds the target session file until the matching list arrives, keyed on `encoded|archived` so a jump into the archive never resolves against the live list.

All global keybindings live in `src/ui/keys.ts`. The palette check must run before everything else in `useAppInput`, including the search branch: the navigation below it treats a bare `k` as "move up" without checking `key.ctrl`.

### UI layout

`App.tsx` owns all TUI state. Focus is a three-value hierarchy (`projects`, `sessions`, `details`); sessions always belong to the highlighted project regardless of which panel has focus, and the centre panel follows focus. Each list keeps its own search query.

Panels are sized from `useTerminalSize()` and pass explicit `height`/`width` down. Ink does not clip overflow, so components take a height and window their own content rather than relying on the parent to cut them off. `dialogs.tsx` shows the pattern: content-aware width, viewport windowing with a scroll offset, and tiered chrome overhead for small terminals.

### Resume handoff

Resuming does not wrap Claude Code. `LauncherService.request(plan)` stores a validated plan, Ink unmounts, `cli.tsx` leaves the alternate screen and only then `spawnSync`s `claude --resume` with stdio inherited. Validation (missing binary, moved project directory, deleted or archived session file) happens before the interface exits so failures surface as dialogs, not a broken terminal. Launch modes are data in `LAUNCH_MODES`; a new mode is an entry there, not UI changes.

## Conventions

- ESM throughout (`"type": "module"`, `module: NodeNext`). Relative imports must carry the `.js` extension, including from `.tsx` files.
- Runtime dependencies are `ink`, `react`, and `tar` only. No shell-outs, no extra CLI tools. Keep it that way.
- Path handling is separator-aware and cross-device moves fall back to copy-and-delete (`core/fsx.ts`). Windows is a design target even though it is untested.
- Comments explain why a constraint exists, not what the code does. Match that density and tone.
