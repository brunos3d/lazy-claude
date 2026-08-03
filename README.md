# Lazy Claude

A complete management application for Claude Code sessions and project history, with a LazyGit-style TUI and a fully scriptable CLI.

Claude Code stores one folder per project under `~/.claude/projects/`, one JSONL file per session, and a `history.jsonl` index. That data breaks when projects move, accumulates orphans, and is hard to inspect by hand. Lazy Claude owns the whole problem: browsing, moving, repairing, backing up, packing, and cleaning, all implemented natively in TypeScript with no external CLI dependencies and no shell execution.

## Features

- Project discovery from `history.jsonl` plus session folder scanning, with recorded-cwd resolution for folders that have no history entry
- Session browsing per project or across all projects, with metadata (summary, working directory, first message, size, activity) and integrity checks
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
lazy-claude    # or the short alias: lzc
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

Run `lazy-claude` with no arguments. The interface follows LazyGit: a Projects panel, a Sessions panel, a Detail panel, and a help bar. Every operation is reachable by keyboard; destructive actions always show a confirmation with the exact planned steps.

| Key | Action |
|-----|--------|
| `↑`/`k`, `↓`/`j` | move selection |
| `tab`, `←`/`→`, `h`/`l` | switch panel |
| `enter` / `esc` | drill in / back |
| `m` | move project (migrates all references) |
| `F` | repair broken references |
| `D` | remove project and all session data |
| `p` | pack project into a `.claudepack` |
| `U` | unpack a `.claudepack` |
| `B` | backup manager |
| `i` | project info |
| `V` | health check |
| `P` | prune orphaned session folders |
| `a` / `r` | archive / restore session |
| `d` / `x` | delete session |
| `c` | check session integrity |
| `t` | toggle live / archived sessions |
| `R` / `?` / `q` | refresh / help / quit |

## CLI

Everything in the TUI is also a command. The CLI and TUI share the same service layer, so behavior is identical.

```bash
lazy-claude list [--json]            # all projects with status
lazy-claude sessions [archived]      # all sessions
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

## How it works

Claude Code encodes each project path into a folder name by replacing every character outside `[a-zA-Z0-9]` with `-` (verified against real data: `/home/user/.claude-mem` becomes `-home-user--claude-mem`). The encoding is lossy, so Lazy Claude never decodes folder names. Matching always goes forward, from a known path to its encoded form, and unknown folders are resolved through the `cwd` values recorded inside their session files.

Nested projects need care: `/a/foo-bar` shares the encoded prefix of `/a/foo`, so a name match alone cannot distinguish a sub-project from a sibling. A folder is treated as nested only when a history entry under the source encodes exactly to its name, or when its session files record a cwd inside the source.

Moves and repairs run as journaled multi-step operations: back up `history.jsonl`, move or merge folders, rewrite history entries. If any step fails, completed steps are undone in reverse order.

Archiving moves a session file to `~/.claude/lazy-claude/archive/<encoded-project>/`, outside the projects directory, so Claude Code stops listing it until restored. Move and repair keep archive folders in sync with their projects.

The data directory resolves in this order: `LAZY_CLAUDE_CLAUDE_DIR` (useful for tests), `CLAUDE_CONFIG_DIR` (the same variable Claude Code respects), then `~/.claude`.

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
    fsx.ts               move/merge/copy primitives with cross-device fallbacks
    history.ts           history.jsonl read/rewrite/remove/append
    nested.ts            nested project folder detection
    journal.ts           undo journal for rollback
    format.ts            size, time and path formatting
  services/
    DiscoveryService.ts  project discovery
    SessionService.ts    session list/detail/archive/restore/delete/validate
    ProjectService.ts    project info and removal
    MoveService.ts       journaled project moves
    RepairService.ts     broken reference detection and relinking
    BackupService.ts     history.jsonl backup create/list/restore/delete
    PackService.ts       .claudepack pack/unpack
    DiagnosticsService.ts  health check, prune, doctor
    relocate.ts          shared folder-rename and history-rewrite logic
  ui/                    Ink components: App, panels, modal dialogs
```

The UI contains no business logic. Both the CLI commands and the TUI flows call the same services, which makes new operations a matter of adding a service function, a command, and a keybinding.

## Supported platforms

| Platform | Status |
|----------|--------|
| Linux | primary target, developed and tested here |
| macOS | expected to work, including case-insensitive path canonicalization |
| Windows | designed for, not yet tested |

All filesystem work uses Node.js APIs, path handling is separator-aware, the encoding treats `\` and `:` the same way Claude Code does on Windows, and cross-device moves fall back to copy-and-delete. The only runtime dependencies are `ink`, `react`, and `tar`.

## Roadmap

- Search across session content
- Bulk actions (archive or delete sessions by age)
- Session preview (transcript rendering) in the detail panel
- Homebrew and AUR packaging once the npm release is out

## Credits

Inspired by [LazyGit](https://github.com/jesseduffield/lazygit) for the interface model, and by [Clamp](https://github.com/wsagency/claude-move-project), whose behavior served as the reference for the session-migration semantics.

## License

MIT
