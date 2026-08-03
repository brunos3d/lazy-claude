# Lazy Claude

A complete management application for Claude Code sessions and project history, with a LazyGit-style TUI and a fully scriptable CLI.

Claude Code stores one folder per project under `~/.claude/projects/`, one JSONL file per session, and a `history.jsonl` index. That data breaks when projects move, accumulates orphans, and is hard to inspect by hand. Lazy Claude owns the whole problem: browsing, moving, repairing, backing up, packing, and cleaning, all implemented natively in TypeScript with no external CLI dependencies and no shell execution.

## Features

- Sessions listed by their real title, the same one Claude Code's resume picker shows, with the id, age, size, and git branch as secondary facts
- Rich session detail: message and tool-call counts, files touched and created, token usage, duration, model, Claude Code version, plus a conversation preview, an activity timeline, and a file list
- Hierarchical navigation in the style of LazyGit: a project list and the selected project's sessions stay visible together, while the wide panel follows focus between project summary and session details
- Contextual action menu (`x`) listing every available operation, including the ones currently unavailable and why
- Resume a session in Claude Code (`e`), or resume with permission prompts skipped (`E`), handing the terminal over from the project's own directory
- Fuzzy search (`/`) in both panels, fzf-style: `lz` finds `lazy-claude`, `vrt` finds `vortex-platform`, with matched characters highlighted and results ranked by match quality
- Open straight into a workspace with `lazy-claude .` or `lazy-claude <path>`
- Project discovery from `history.jsonl` plus session folder scanning, with recorded-cwd resolution for folders that have no history entry
- Move a project: relocates the directory and migrates every reference, including nested sub-project and worktree session folders, archived sessions, and history entries, with automatic rollback on failure
- Repair references after a manual `mv`: auto-detects broken entries, searches likely new locations, and relinks explicitly or interactively
- Archive, restore, and delete individual sessions
- Pack a project with its sessions into a portable `.claudepack` archive; unpack rewrites paths for the new machine or location
- Timestamped `history.jsonl` backups before every mutation, with a backup manager to create, restore, and delete them
- Health check and prune for orphaned session folders
- Dry-run mode on every destructive operation

## Installation

Not yet published to npm. Once it is:

```bash
npm i -g lazy-claude
lazy-claude    # aliases: lazyclaude, lzc
```

Until then, install from source:

```bash
git clone https://github.com/brunos3d/lazy-claude.git
cd lazy-claude
npm install
npm run build
npm link       # exposes lazy-claude and lzc globally
```

## TUI

```bash
lazy-claude          # browse every project
lazy-claude .        # open the current workspace directly
lazy-claude ~/code/app
```

The left column is a hierarchy: projects on top, the selected project's sessions below. Both stay on screen, so the workspace you are in never disappears while you browse its sessions. The wide panel on the right follows focus, showing the project summary while Projects has focus and the session details once Sessions or Details does, with tabs for overview, conversation preview, timeline, and file activity.

```
┌──────────────────────────────┐┌────────────────────────┐
│ Projects                     ││ Project summary,       │
│   ~/github/project-a         ││ or session details     │
│ ▶ ~/github/lazy-claude       ││ once a session has     │
│   ~/github/project-c         ││ focus                  │
├──────────────────────────────┤│                        │
│ Sessions: ~/github/lazy-claude││                       │
│ ▶ Build Lazy Claude UI       ││                        │
│   Fix Windows support        ││                        │
└──────────────────────────────┘└────────────────────────┘
```

Focus moves with `tab` (Projects, Sessions, Details), `enter` to step down, and `esc` to step back up. The focused panel has a green border and paints its selection as a solid bar; the other panels keep a `▶` marker so the current project and session stay identifiable. Destructive actions confirm with the exact planned steps.

The inspector has its own tab bar under the panel title, separated from the content by a rule. The active tab is a filled blue button, inactive tabs sit at low contrast, and each carries the number that selects it, so `1`..`4` are discoverable without opening the help. Green stays reserved for titles and status, so navigation never reads as body text.

Press `x` anywhere for the action menu, which lists every operation available for the current selection. The shortcuts below also work directly.

Dialogs are overlays, not screens. The action menu, confirmations, pickers, and reports draw on top of the interface while the panels stay visible and keep their selection, so closing a dialog returns you exactly where you were. Only the top dialog receives keys; the panels underneath are inert until it closes. Dialogs stack, so a confirmation raised from a picker layers over it.

| Key              | Action                                        |
| ---------------- | --------------------------------------------- |
| `↑`/`k`, `↓`/`j` | move within the focused panel                 |
| `tab`            | cycle Projects, Sessions, Details             |
| `enter`          | step down the hierarchy                       |
| `esc`            | step back up                                  |
| `1`..`4`         | switch inspector tab (numbers shown in the bar) |
| `J` / `K`        | scroll the detail panel from anywhere         |
| `/`              | fuzzy-search the focused list                 |
| `x`              | contextual action menu                        |
| `m`               | move project (migrates all references) |
| `F`               | repair broken references               |
| `D`               | remove project and all session data    |
| `p`               | pack project into a `.claudepack`      |
| `U`               | unpack a `.claudepack`                 |
| `B`               | backup manager                         |
| `i`               | project info                           |
| `V`               | health check                           |
| `P`               | prune orphaned session folders         |
| `e`               | resume the session in Claude Code      |
| `E`               | resume, skipping permission prompts    |
| `a` / `r`         | archive / restore session              |
| `d`               | delete session                         |
| `c`               | check session integrity                |
| `t`               | toggle live / archived sessions        |
| `R` / `M`         | rescan / refresh metadata cache        |
| `?` / `q`         | help / quit                            |

## CLI

Everything in the TUI is also a command. The CLI and TUI share the same service layer, so behavior is identical.

```bash
lazy-claude list [--json]            # all projects with status
lazy-claude sessions [archived]      # all sessions, titled
lazy-claude show <session-id>        # stats, preview and timeline
lazy-claude search <query>           # match titles, ids, paths, branches
lazy-claude info [path] [--json]     # project details (defaults to cwd)
lazy-claude doctor                   # environment summary
lazy-claude verify                   # health check (exit 1 when issues found)

lazy-claude move <src> <dest>        # move project + migrate references
lazy-claude move --here <src>        # move project into the current dir
lazy-claude repair                   # scan and relink broken references
lazy-claude repair <new-path>        # relink a moved project by new path
lazy-claude repair --from A --to B   # relink explicitly
lazy-claude prune                    # remove orphaned session folders
lazy-claude remove <path>            # delete project + all session data

lazy-claude pack <path> [archive]    # create .claudepack
lazy-claude unpack <archive> <dest>  # restore .claudepack

lazy-claude backup                   # list history backups
lazy-claude backup create
lazy-claude backup restore <name>
lazy-claude backup delete <name>

lazy-claude session archive <id>     # ids accept unique prefixes
lazy-claude session restore <id>
lazy-claude session delete <id>
lazy-claude session check <id>       # integrity scan
```

Common flags: `-n/--dry-run`, `-f/--force`, `-p/--parents`, `--no-backup`, `--json`.

## How this differs from `/cd` and `/add-dir`

Claude Code binds a session to the absolute path it was started from. Transcripts live at `~/.claude/projects/<encoded-path>/<session-id>.jsonl`, and that path is encoded both in the folder name and inside the file contents. Move or rename a repository and every prior session stops showing up from the new location.

Two built-ins touch this area, and they solve different problems. `/cd` changes the working directory of the session you have open, keeping conversation history, model selection, and prompt cache, and reloading the new directory's `CLAUDE.md`. Since v2.1.169 it also relocates that session's storage, so the session appears in the new directory's picker; since v2.1.196 it stays out of the old directory's picker after a crash or forced exit. It is the right tool when you are mid-work and want to continue elsewhere, but its scope is exactly one session: moving N sessions means resuming each and running `/cd` N times. `/add-dir` grants the open session access to an additional directory and relocates nothing. Sessions that added the current directory this way do appear in its picker, which can resemble migration without being it.

|                                | Scope                                     | Session must be open | Moves storage on disk    | N sessions per invocation | Rewrites paths inside transcripts |
| ------------------------------ | ----------------------------------------- | -------------------- | ------------------------ | ------------------------- | --------------------------------- |
| `/cd`                          | the one open session                      | Yes                  | Yes, from v2.1.169       | No, one at a time         | Internal to Claude Code           |
| `/add-dir`                     | the one open session                      | Yes                  | No                       | No                        | No                                |
| `lazy-claude move`             | a project and every session bound to it   | No                   | Yes, project and folders | Yes                       | No                                |
| `lazy-claude repair`           | same, when the directory already moved    | No                   | Yes, session folders     | Yes                       | No                                |
| `lazy-claude pack` / `unpack`  | one project, archived and restored        | No                   | Yes                      | Yes                       | Yes, on unpack                    |

`lazy-claude move` operates on a project rather than a session. It moves the directory, renames the session folder for every session bound to it, migrates the folders of nested sub-projects and worktrees, updates `history.jsonl`, and keeps archived sessions in sync. Nothing has to be resumed. `lazy-claude repair` performs the same relocation when the directory was already moved with `mv`. Both accept `-n/--dry-run` to print the plan first, and both run as journaled operations that undo completed steps if a later one fails.

Use `/cd` for a single live session you are working in right now. Use Lazy Claude when relocating a repository together with its full history, or repairing one that already moved. There is no built-in bulk equivalent; the open request is [anthropics/claude-code#27473](https://github.com/anthropics/claude-code/issues/27473).

One caveat worth stating plainly: this depends on an on-disk layout that is internal to Claude Code and changes between versions. `move`, `repair`, `remove`, and `unpack` back up `history.jsonl` first (unless `--no-backup`), but that backup does not include transcripts. For a full snapshot before a large change, run `lazy-claude pack`. See the [sessions documentation](https://code.claude.com/docs/en/sessions).

## Resuming a session

Finding a session is usually a prelude to continuing it, so the two resume actions lead the action menu ahead of every management operation. `e` resumes the highlighted session and `E` resumes it with `--dangerously-skip-permissions`, which asks for confirmation first and shows the exact command it will run.

Both hand the terminal over rather than wrapping it: Lazy Claude unmounts, leaves the alternate screen, prints the shell equivalent, then executes Claude Code in the project's own directory with stdio inherited. What you get is the same as typing:

```bash
cd <project-directory>
claude --resume <session-id>
```

Everything is validated before the interface exits, so a missing Claude Code executable, a project directory that has moved, a deleted session file, or an archived session (invisible to Claude Code until restored) each produce a dialog you can act on instead of a broken handoff. Set `LAZY_CLAUDE_CLAUDE_BIN` if `claude` is not on your `PATH`.

Launch modes are data in `LauncherService`, contributing arguments, environment, and an optional command wrapper. Adding a read-only mode, a different model, or launching inside tmux means adding an entry there; the menu picks it up without UI changes.

## Fuzzy search

Press `/` to search the focused panel. Matching is fuzzy in the fzf sense: the characters you type must appear in order but not adjacently, so `lz` finds `lazy-claude` and `agn` finds `agenda-zap`. Results are ranked, rewarding consecutive runs, characters at the start of a path or word segment, and matches near the beginning of the text. Matched characters are highlighted in the list.

Filtering is incremental. `esc` clears the query, a second `esc` steps back up the hierarchy, `enter` keeps the filter and hands the keyboard back to the list, and `ctrl+u` clears the query without leaving search. Each panel keeps its own query, so filtering projects does not disturb a session filter.

Projects match on their path. Sessions match on title, git branch, and session id. Session matching deliberately excludes the project path: fuzzy matching against long absolute paths matches almost everything (`clm` matches `/home/user/.claude-mem/...`, which alone can own hundreds of sessions), which buries real title hits. Narrowing by project is what the Projects panel is for.

Adding a new searchable attribute means appending a field in `SearchService`, which is also where an on-disk content index over prompts, summaries, and modified files would plug in.

## Session titles and metadata

Claude Code writes an `ai-title` record into each session file, which is what the resume picker displays. It sits near the end of a multi-megabyte file, so Lazy Claude reads a chunk from each end of the file rather than parsing all of it, and caches the result keyed by file size and mtime. A first scan of ~800 sessions takes about a quarter of a second; later launches are instant.

When a session has no AI title, the label falls back in order to the opening prompt, the first user message, the slash command that started it, and finally `(empty session)` for sessions that only contain hook and system records. Inferred titles are dimmed in the list so a guess never looks like a real title.

Opening a session runs one deeper pass over the file to derive statistics, the timeline, and the preview together. Everything on the detail tabs comes from that single pass.

## How it works

Claude Code encodes each project path into a folder name by replacing every character outside `[a-zA-Z0-9]` with `-` (verified against real data: `/home/user/.claude-mem` becomes `-home-user--claude-mem`). The encoding is lossy, so Lazy Claude never decodes folder names. Matching always goes forward, from a known path to its encoded form, and unknown folders are resolved through the `cwd` values recorded inside their session files.

Nested projects need care: `/a/foo-bar` shares the encoded prefix of `/a/foo`, so a name match alone cannot distinguish a sub-project from a sibling. A folder is treated as nested only when a history entry under the source encodes exactly to its name, or when its session files record a cwd inside the source.

Moves and repairs run as journaled multi-step operations: back up `history.jsonl`, move or merge folders, rewrite history entries. If any step fails, completed steps are undone in reverse order.

Archiving moves a session file to `~/.claude/lazy-claude/archive/<encoded-project>/`, outside the projects directory, so Claude Code stops listing it until restored. Move and repair keep archive folders in sync with their projects.

The data directory resolves in this order: `LAZY_CLAUDE_CLAUDE_DIR` (useful for tests), `CLAUDE_CONFIG_DIR` (the same variable Claude Code respects), then `~/.claude`.

## Supported platforms

| Platform | Status                                                             |
| -------- | ------------------------------------------------------------------ |
| Linux    | primary target, developed and tested here                          |
| macOS    | expected to work, including case-insensitive path canonicalization |
| Windows  | designed for, not yet tested                                       |

All filesystem work uses Node.js APIs, path handling is separator-aware, the encoding treats `\` and `:` the same way Claude Code does on Windows, and cross-device moves fall back to copy-and-delete. The only runtime dependencies are `ink`, `react`, and `tar`.

## Architecture

```
src/
  cli.tsx                entry point and usage text
  cli/
    args.ts              flag parsing
    prompt.ts            interactive confirmation and selection
    commands.ts          one function per CLI command
  core/
    paths.ts             data directory resolution and path encoding
    fuzzy.ts             fzf-style subsequence matching and scoring
    jsonl.ts             head/tail chunk readers and record streaming
    fsx.ts               move/merge/copy primitives with cross-device fallbacks
    history.ts           history.jsonl read/rewrite/remove/append
    nested.ts            nested project folder detection
    journal.ts           undo journal for rollback
    format.ts            size, time, duration and token formatting
  services/
    DiscoveryService.ts        project discovery
    SessionService.ts          session list/archive/restore/delete/validate
    SessionMetadataService.ts  titles and per-session metadata, cached
    ConversationService.ts     statistics, timeline and preview parsing
    MetadataCache.ts           versioned on-disk cache, the seam for indexing
    WorkspaceResolver.ts       cwd to project, for `lazy-claude .`
    FilterService.ts           generic ranked filtering over documents
    SearchService.ts           what projects and sessions are searchable by
    ProjectService.ts          project info and removal
    MoveService.ts             journaled project moves
    RepairService.ts           broken reference detection and relinking
    BackupService.ts           history.jsonl backup create/list/restore/delete
    PackService.ts             .claudepack pack/unpack
    LauncherService.ts         resume handoff to Claude Code, launch modes
    DiagnosticsService.ts      health check, prune, doctor
    relocate.ts                shared folder-rename and history-rewrite logic
  ui/                    Ink components: App, panels, rows, detail tabs
    overlay/
      OverlayContext.tsx   overlay stack, plus the input-gating hooks
      OverlayHost.tsx      renders the stack as the last root sibling
      Modal.tsx            absolutely positioned, opaque modal frame
      dialogs.tsx          confirm, input, picker, output, action menu
```

The overlay system is one place, not one implementation per dialog. `OverlayProvider` holds a stack, `OverlayHost` renders it as the final sibling of a `position="relative"` root (Ink composites siblings in order, which is what puts dialogs on top), and `Modal` paints every interior line as a full-width `Text` with a background colour so the UI behind cannot bleed through. Input is gated centrally: `useOverlayInput` only fires for the top overlay and `useAppInput` only fires when the stack is empty. A new dialog type means adding a spec to the union and a case to the host.

The UI contains no parsing or business logic. Every record shape Claude Code writes is understood in exactly one place: `SessionMetadataService` for cheap per-session facts and `ConversationService` for the deep pass. Both the CLI commands and the TUI flows call the same services, so a new operation means adding a service function, a command, and an entry in the action menu.

Search takes documents rather than raw sessions, and `MetadataCache` is versioned and staleness-checked. When a full-text index over prompts and file names lands, it populates the `keywords` field and everything downstream keeps working unchanged.

## Roadmap

- Full-text index over prompts, assistant summaries, and modified files
- Bulk actions (archive or delete sessions by age, clean up empty sessions)
- Resume a session directly from the TUI
- Project aliases so long paths get short names
- Homebrew and AUR packaging once the npm release is out

## Credits

Inspired by [LazyGit](https://github.com/jesseduffield/lazygit) for the interface model, and by [Clamp](https://github.com/wsagency/claude-move-project), whose behavior served as the reference for the session-migration semantics.

## License

MIT
