# Lazy Clamp

A terminal UI for browsing and managing Claude Code sessions, in the spirit of [LazyGit](https://github.com/jesseduffield/lazygit). It wraps [Clamp](https://github.com/wsagency/claude-move-project) for project-level operations and adds session-level actions (archive, restore, delete) on top.

## What it does

Claude Code stores one folder per project under `~/.claude/projects/`, with one JSONL file per session. Lazy Clamp gives you a keyboard-driven view of all of it:

- a Projects panel listing every Claude project on the machine, with health status (healthy, missing path, orphaned session folder)
- a Sessions panel showing sessions for the highlighted project, or all sessions across every project from the root "All sessions" entry
- a Detail panel with session metadata: summary, working directory, first message, size, last activity
- confirmation dialogs for every destructive action

## Relation to Clamp

Clamp is a bash script that moves, lists, verifies, prunes and repairs Claude Code project data. Lazy Clamp shells out to it for the operations Clamp already does well:

- `clamp --list --json` feeds the Projects panel
- `clamp --info` powers the project info view (`i`)
- `clamp --verify` runs the health check (`V`)
- `clamp --prune` removes orphaned session folders (`P`)

Session archive, restore and delete are Lazy Clamp features. Clamp has no per-session commands, so Lazy Clamp operates on the JSONL files directly. Archived sessions move to `~/.claude/lazy-clamp/archive/<encoded-project>/`, outside `~/.claude/projects/`, so Claude Code and Clamp stop seeing them until you restore.

### Which Clamp binary is used

The upstream fixes from [claude-move-project PR #15](https://github.com/wsagency/claude-move-project/pull/15) are not merged yet, so the local clone is treated as the source of truth. Lazy Clamp resolves the binary in this order:

1. `LAZY_CLAMP_BIN` environment variable
2. `~/github/cloned/claude-move-project/clamp` (the local clone with the PR #15 fixes)
3. `clamp` on `PATH`

Run `lazy-clamp doctor` to see which binary was picked. Once the PR is merged and released, remove the local clone or point `LAZY_CLAMP_BIN` at the released version and the PATH fallback takes over.

## Running locally

Requires Node.js 18 or newer.

```bash
git clone https://github.com/brunos3d/lazy-clamp.git
cd lazy-clamp
npm install
npm run build
node dist/cli.js
```

For a global command during development:

```bash
npm link
lazy-clamp    # or the shorter alias: lzclamp
```

## Commands

```bash
lazy-clamp            # open the TUI
lazy-clamp list       # print projects as JSON (via clamp --list --json)
lazy-clamp doctor     # show which clamp binary is resolved
lazy-clamp --help
lazy-clamp --version
```

## Keybindings

| Key | Action |
|-----|--------|
| `↑`/`k`, `↓`/`j` | move selection |
| `tab`, `←`/`→`, `h`/`l` | switch panel |
| `enter` | open sessions of the highlighted project |
| `esc` | back to the Projects panel |
| `a` | archive session |
| `r` | restore an archived session |
| `d` / `x` | delete session (asks for confirmation) |
| `t` | toggle live / archived view |
| `i` | project info (`clamp --info`) |
| `V` | health check (`clamp --verify`) |
| `P` | prune orphaned session folders (`clamp --prune`) |
| `R` | refresh |
| `?` | help |
| `q` | quit |

## Installing through npm (later)

The package is ready for publishing: `bin` exposes `lazy-clamp` and `lzclamp`, `files` ships only `dist/`, and `prepublishOnly` builds first. Once published, installation becomes:

```bash
npm i -g lazy-clamp
```

## Architecture

```
src/
  cli.tsx           entry point: arg parsing, TTY check, alt-screen, render
  lib/
    paths.ts        Claude data directory and path encoding
    clamp.ts        Clamp binary resolution and subprocess calls (execution)
    sessions.ts     session listing, metadata parsing, archive/restore/delete
    format.ts       size, time and path formatting
  ui/
    App.tsx         state, keyboard handling, layout
    DetailPanel.tsx session and project detail rendering
    ListView.tsx    scrollable list with a selection window
    Panel.tsx       bordered panel with focus highlight
    ConfirmDialog.tsx, OutputOverlay.tsx, HelpBar.tsx
    useTerminalSize.ts
```

Listing lives in `lib/` and is separate from the UI, so new actions (move, pack, unpack) can be added by extending `lib/clamp.ts` and wiring a keybinding in `App.tsx`.

## Environment variables

| Variable | Purpose |
|----------|---------|
| `LAZY_CLAMP_BIN` | path to the Clamp script to use |
| `LAZY_CLAMP_CLAUDE_DIR` | Claude data directory, defaults to `~/.claude` (useful for tests) |

## License

MIT
