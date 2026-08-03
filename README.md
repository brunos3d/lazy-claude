# Lazy Claude

A keyboard-driven terminal UI for managing Claude Code sessions and project history, in the spirit of [LazyGit](https://github.com/jesseduffield/lazygit) and LazyDocker.

Claude Code stores one folder per project under `~/.claude/projects/`, with one JSONL file per session. Over time this accumulates hundreds of sessions across dozens of projects. Lazy Claude gives you a full view of that data and the tools to keep it tidy.

## Features

- Projects panel listing every Claude Code project on the machine, with health status: healthy, missing project directory, or orphaned session folder
- Sessions panel showing sessions per project, or all sessions across every project
- Detail panel with session metadata: summary, working directory, first message, size, last activity
- Archive sessions (move them out of Claude Code's view, reversible)
- Restore archived sessions
- Delete sessions permanently
- Health check for broken project references and orphaned data
- Prune orphaned session folders
- Confirmation dialogs for every destructive action

Everything is implemented natively in TypeScript on Node.js filesystem APIs. There are no runtime dependencies on other CLI tools and no shell execution.

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

## Commands

```bash
lazy-claude           # open the TUI
lazy-claude list      # print discovered projects as JSON
lazy-claude doctor    # show data directory and discovery stats
lazy-claude --help
lazy-claude --version
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
| `i` | project info |
| `V` | health check |
| `P` | prune orphaned session folders |
| `R` | refresh |
| `?` | help |
| `q` | quit |

## How it works

Claude Code encodes each project path into a folder name by replacing every character outside `[a-zA-Z0-9]` with `-` (for example `/home/user/.claude-mem` becomes `-home-user--claude-mem`). The encoding is lossy, so Lazy Claude never tries to decode folder names. Discovery works forward:

1. Project paths are read from `~/.claude/history.jsonl`.
2. Session folders that match no known path encoding are resolved by reading the `cwd` recorded inside their session files.
3. Folders with no resolvable path are reported as orphaned.

Archiving moves a session file to `~/.claude/lazy-claude/archive/<encoded-project>/`. That directory sits outside `projects/`, so Claude Code stops listing the session until you restore it. Deleting removes the file permanently.

The data directory resolves in this order: `LAZY_CLAUDE_CLAUDE_DIR` (useful for tests), `CLAUDE_CONFIG_DIR` (the same variable Claude Code respects), then `~/.claude`.

## Architecture

```
src/
  cli.tsx             entry point: arg parsing, TTY check, alt-screen, render
  lib/
    paths.ts          data directory resolution and project path encoding
    projects.ts       project discovery and stats
    sessions.ts       session discovery, metadata parsing, archive/restore/delete
    maintenance.ts    health check, prune, project info
    format.ts         size, time and path formatting
  ui/
    App.tsx           state, keyboard handling, layout
    DetailPanel.tsx   session and project detail rendering
    ListView.tsx      scrollable list with a selection window
    Panel.tsx         bordered panel with focus highlight
    ConfirmDialog.tsx, OutputOverlay.tsx, HelpBar.tsx
    useTerminalSize.ts
```

The `lib/` layer is UI-independent: every operation the TUI performs is a plain async function. New actions are added by writing a function in `lib/` and wiring a keybinding in `App.tsx`. The same layer backs the non-interactive commands (`list`, `doctor`), which keeps future packaging for other distribution channels (Homebrew, AUR) a matter of shipping the same Node entry point.

## Supported platforms

| Platform | Status |
|----------|--------|
| Linux | primary target, developed and tested here |
| macOS | expected to work, same POSIX layout |
| Windows | designed for, not yet tested |

All filesystem work uses Node.js APIs (`fs`, `path`, `os.homedir()`), path joins are separator-aware, and the path encoding handles `\` and `:` the same way Claude Code does on Windows. Cross-device moves fall back to copy-and-delete.

## Roadmap

- Move a project (relocate the directory and rewrite session references)
- Fix references after a manual `mv`
- Pack/unpack a project with its sessions into a portable archive
- Search across session content
- Bulk actions (archive or delete by age)

## Credits

Inspired by [LazyGit](https://github.com/jesseduffield/lazygit) for the interface model, and by [Clamp](https://github.com/wsagency/claude-move-project), whose approach to Claude Code's on-disk layout informed early versions of this project.

## License

MIT
