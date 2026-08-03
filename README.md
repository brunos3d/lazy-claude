# Lazy Claude

A complete management application for Claude Code sessions and project history, with a LazyGit-style TUI and a fully scriptable CLI.

Claude Code stores one folder per project under `~/.claude/projects/`, one JSONL file per session, and a `history.jsonl` index. That data breaks when projects move, accumulates orphans, and is hard to inspect by hand. Lazy Claude owns the whole problem: browsing, moving, repairing, backing up, packing, and cleaning, all implemented natively in TypeScript with no external CLI dependencies and no shell execution.

## Features

- Sessions listed by their real title, the same one Claude Code's resume picker shows, with the id, age, size, and git branch as secondary facts
- Rich session detail: message and tool-call counts, files touched and created, token usage, duration, model, Claude Code version, plus a conversation preview, an activity timeline, and a file list
- Contextual navigation in the style of LazyGit: projects drill into sessions, and the wide panel always describes the current selection
- Contextual action menu (`x`) listing every available operation, including the ones currently unavailable and why
- Search (`/`) across titles, ids, paths, and branches
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

The left column is contextual: it lists projects, and drilling into one replaces it with that project's sessions. The wide right panel always describes the current selection, with tabs for a session's overview, conversation preview, timeline, and file activity. Destructive actions confirm with the exact planned steps.

Press `x` anywhere for the action menu, which lists every operation available for the current selection. The shortcuts below also work directly.

| Key               | Action                                 |
| ----------------- | -------------------------------------- |
| `↑`/`k`, `↓`/`j`  | move selection                         |
| `enter` / `esc`   | drill into sessions / back to projects |
| `tab` or `1`..`4` | switch detail tab                      |
| `J` / `K`         | scroll the detail panel                |
| `/`               | search the current list                |
| `x`               | contextual action menu                 |
| `m`               | move project (migrates all references) |
| `F`               | repair broken references               |
| `D`               | remove project and all session data    |
| `p`               | pack project into a `.claudepack`      |
| `U`               | unpack a `.claudepack`                 |
| `B`               | backup manager                         |
| `i`               | project info                           |
| `V`               | health check                           |
| `P`               | prune orphaned session folders         |
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
    SearchService.ts           document-based matching over sessions
    ProjectService.ts          project info and removal
    MoveService.ts             journaled project moves
    RepairService.ts           broken reference detection and relinking
    BackupService.ts           history.jsonl backup create/list/restore/delete
    PackService.ts             .claudepack pack/unpack
    DiagnosticsService.ts      health check, prune, doctor
    relocate.ts                shared folder-rename and history-rewrite logic
  ui/                    Ink components: App, panels, rows, modals, menus
```

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
