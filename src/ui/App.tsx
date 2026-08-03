import React, { useCallback, useEffect, useMemo, useState } from 'react';
import os from 'node:os';
import path from 'node:path';
import { Box, Text, useApp } from 'ink';
import { DiscoveryService, type Project } from '../services/DiscoveryService.js';
import { DiagnosticsService } from '../services/DiagnosticsService.js';
import { ProjectService } from '../services/ProjectService.js';
import { MoveService } from '../services/MoveService.js';
import { RepairService } from '../services/RepairService.js';
import { PackService } from '../services/PackService.js';
import { BackupService, type Backup } from '../services/BackupService.js';
import { LABEL_FIELD, SearchService } from '../services/SearchService.js';
import { StatsService } from '../services/StatsService.js';
import {
  DEFAULT_VIEW,
  PROJECT_SORTS,
  SESSION_SORTS,
  ViewService,
  type WorkspaceView,
} from '../services/ViewService.js';
import { ActionRegistry } from '../services/actions/ActionRegistry.js';
import { registerDefaultActions } from '../services/actions/register.js';
import { SessionMetadataService, type SessionMetadata } from '../services/SessionMetadataService.js';
import { ConversationService, type Conversation } from '../services/ConversationService.js';
import {
  LAUNCH_MODES,
  LauncherService,
  LaunchError,
  type LaunchMode,
} from '../services/LauncherService.js';
import {
  archiveSession,
  deleteSession,
  listAllArchivedSessions,
  listAllSessions,
  listArchivedSessions,
  listSessions,
  restoreSession,
  validateSession,
  type SessionEntry,
} from '../services/SessionService.js';
import { formatBytes, formatKb, formatRelativeTime, shortenPath } from '../core/format.js';
import { HelpBar } from './HelpBar.js';
import { ListView } from './ListView.js';
import { Panel } from './Panel.js';
import { SearchRow } from './SearchRow.js';
import { AllSessionsRow, ProjectRow, SessionRow } from './rows.js';
import {
  DETAIL_TAB_DEFS,
  DETAIL_TABS,
  SessionDetail,
  type DetailTab,
} from './SessionDetail.js';
import { TabBar } from './TabBar.js';
import { ProjectDetail } from './ProjectDetail.js';
import { useTerminalSize } from './useTerminalSize.js';
import { OverlayProvider, useAppInput, useOverlays } from './overlay/OverlayContext.js';
import { OverlayHost } from './overlay/OverlayHost.js';
import { buildActionCategories, findShortcut } from './actions/registry.js';
import { FOCUS_ORDER, type Focus, type ProjectItem } from './types.js';
import { SearchIndexer } from '../services/search/SearchIndexer.js';
import { registerDefaultProviders } from '../services/search/register.js';
import { KEYS } from './keys.js';
import { pendingKey, useJumpTarget, type JumpActions } from './useJumpTarget.js';
import type { SelectTarget } from '../services/search/types.js';

// Providers are process-wide, so registration happens once at load rather
// than on every mount of the palette.
registerDefaultProviders();
registerDefaultActions();

/**
 * Actions that keep a global shortcut. These act on the highlighted item
 * and are used constantly; everything else lives in the palette (x).
 */
const QUICK_KEYS = new Set(['e', 'E', 'a', 'r', 'd', 'c']);

export interface AppProps {
  /** Project to open directly, from `lazyclaude <path>`. */
  initialProject?: string;
}

const HELP_TEXT = `Lazy Claude

Layout
  The left column is a hierarchy: projects on top, the selected
  project's sessions below. The project list never disappears, so the
  current workspace stays visible while you browse its sessions. The
  wide panel shows the project summary while Projects has focus, and
  the session details once Sessions or Details does.

Navigation
  ↑/k ↓/j        move within the focused panel
  tab            cycle Projects, Sessions, Details
  enter          focus the session list for the selected project
  esc            clear the query, then the filter, then step back up
  /              search the focused list
  s              sort the focused list
  ctrl+k         command palette: search and run workspace commands
  x              contextual action menu

Details panel
  tab or 1..4    switch tab (overview, conversation, timeline, files)
  J / K          scroll

Command palette (ctrl+k)
  Searches the whole workspace, not just the focused list, and runs
  workspace commands. Results arrive as tabs: Projects, Sessions and
  Actions, switched with tab and shift+tab. Enter jumps to a project or
  session, or runs an action. With the input empty the tabs show recent
  searches and every action, so commands can be found by browsing rather
  than by remembering a shortcut.

  Actions are global: sorting, filters, statistics, and the maintenance
  operations that act on the whole workspace. Anything that acts on the
  highlighted row is in the action menu (x) instead.

Sorting and filtering
  Sort with s, or from the palette. The active sort shows on the right of
  each panel's search row and stays until something else is chosen.
  Project filters (missing on disk, orphaned, empty) come from the
  palette and name themselves in the panel title. esc clears them.

Actions (x)
  Operations on the highlighted project or session, grouped into Session,
  Project and Dangerous. It adapts to whichever panel has focus, so there
  is no separate shortcut set for projects and sessions. Inside it, enter
  runs the selection and a shortcut key runs directly.

Quick shortcuts (these also work outside the palette)
  e              resume the session in Claude Code
  E              resume with --dangerously-skip-permissions (confirms first)
  a              archive session (reversible, hides it from Claude Code)
  r              restore an archived session
  d              delete session permanently
  c              check session file integrity
  t              toggle live / archived sessions

Titles come from the same metadata Claude Code's resume picker uses.
Sessions whose title is dimmed had it inferred from the opening prompt.`;

function expandHome(input: string): string {
  if (input === '~') return os.homedir();
  if (input.startsWith('~/') || input.startsWith('~\\')) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

/**
 * Root: the application tree stays mounted at all times and the overlay
 * host renders above it, so dialogs never replace the interface.
 */
export function App(props: AppProps) {
  return (
    <OverlayProvider>
      <AppShell {...props} />
    </OverlayProvider>
  );
}

function AppShell({ initialProject }: AppProps) {
  const { exit } = useApp();
  const { open, idle } = useOverlays();
  const { columns, rows } = useTerminalSize();
  const home = os.homedir();

  const [projects, setProjects] = useState<Project[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [focus, setFocus] = useState<Focus>('projects');
  const [projectIndex, setProjectIndex] = useState(0);
  const [sessionIndex, setSessionIndex] = useState(0);
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<Map<string, SessionMetadata>>(new Map());
  const [showArchived, setShowArchived] = useState(false);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [detailTab, setDetailTab] = useState<DetailTab>('overview');
  const [detailScroll, setDetailScroll] = useState(0);
  // One query per list, so switching focus never silently re-filters the other.
  const [projectQuery, setProjectQuery] = useState('');
  const [sessionQuery, setSessionQuery] = useState('');
  // How the workspace is being looked at. The sidebar popup and the
  // palette's sorting and filter actions both write here, and every list
  // reads its order from it.
  const [view, setView] = useState<WorkspaceView>(DEFAULT_VIEW);
  const [searching, setSearching] = useState(false);
  const [status, setStatus] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [autoOpened, setAutoOpened] = useState(false);

  const refresh = useCallback(() => setRefreshTick((t) => t + 1), []);
  const showOverlay = useCallback(
    (title: string, body: string) => open({ kind: 'output', title, body }),
    [open],
  );

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    DiscoveryService.discoverProjects()
      .then((list) => {
        if (cancelled) return;
        // Ordering belongs to ViewService, which the rows go through. A
        // sort here as well would be a second implementation, and the two
        // would disagree the moment the user picked anything else.
        setProjects(list);
        // Reuse the discovery that just ran instead of scanning twice, and
        // build in the background so opening the palette never waits.
        SearchIndexer.invalidate();
        // The index is an optimisation, never a dependency of the screen,
        // and `publish()` runs React setters inside the build. A listener
        // that throws must not become an unhandled rejection and take the
        // whole TUI down with it.
        SearchIndexer.warm(list).catch(() => {});
      })
      .catch((error: Error) => {
        if (!cancelled) setLoadError(error.message);
      });
    return () => {
      cancelled = true;
      // Nothing calls process.exit(), so a metadata pass still reading the
      // workspace would hold the event loop open after Ink unmounts and
      // stall the shell. This also fires on refresh, which is what stops
      // repeated refreshes stacking whole-workspace scans.
      SearchIndexer.abort();
    };
  }, [refreshTick]);

  const sortedProjects = useMemo(
    () => ViewService.sortProjects(projects ?? [], view.projectSort),
    [projects, view.projectSort],
  );

  /**
   * Sorted but neither filtered nor searched, and the list a jump plans
   * against.
   *
   * `planJump` returns an index into this array while `projectIndex` reads
   * the rendered rows, so the two only agree when nothing is narrowing the
   * list. That is why a jump clears both queries and the filter: on the
   * next render the rendered rows are exactly this array again. Sorting is
   * safe to leave applied because `planJump` matches on `encoded`.
   */
  const allProjectItems = useMemo<ProjectItem[]>(() => {
    const items: ProjectItem[] = [{ kind: 'all' }];
    for (const project of sortedProjects) items.push({ kind: 'project', project });
    return items;
  }, [sortedProjects]);

  /**
   * Rendered project rows: filter, then either rank by query or keep the
   * sort. A query replaces the sort rather than composing with it, because
   * relevance ranking is itself an ordering and re-sorting would throw it
   * away.
   *
   * The "All sessions" entry drops out whenever the list is narrowed: it is
   * a scope switch, not a project, so it has no business in a set of
   * results.
   */
  const projectRows = useMemo<Array<{ item: ProjectItem; highlights?: number[] }>>(() => {
    const filtered = ViewService.filterProjects(sortedProjects, view.projectFilter);
    if (!projectQuery.trim()) {
      const items: ProjectItem[] =
        view.projectFilter === 'none'
          ? allProjectItems
          : filtered.map((project) => ({ kind: 'project', project }));
      return items.map((item) => ({ item }));
    }
    return SearchService.filterProjects(filtered, projectQuery, home).map((result) => ({
      item: { kind: 'project' as const, project: result.item },
      highlights: result.highlights[LABEL_FIELD],
    }));
  }, [allProjectItems, sortedProjects, view.projectFilter, projectQuery, home]);

  const projectItems = useMemo(() => projectRows.map((row) => row.item), [projectRows]);

  // Open straight into a project when launched with a path.
  useEffect(() => {
    if (autoOpened || !initialProject || !projects) return;
    setAutoOpened(true);
    const index = allProjectItems.findIndex(
      (item) => item.kind === 'project' && item.project.path === initialProject,
    );
    if (index < 0) return;
    setProjectIndex(index);
    setFocus('sessions');
  }, [autoOpened, initialProject, projects, allProjectItems]);

  const selectedItem = projectItems[Math.min(projectIndex, projectItems.length - 1)] ?? null;
  const selectedProject = selectedItem?.kind === 'project' ? selectedItem.project : null;

  /**
   * The session list the current selection asks for. `loadedKey` is the one
   * that has actually arrived, so this leads it by one async hop; a pending
   * jump compares against this to tell "still loading" from "user moved on".
   */
  const currentKey = selectedProject ? pendingKey(selectedProject.encoded, showArchived) : null;

  /** Encoded folder to current project path, for the all-sessions view. */
  const projectByEncoded = useMemo(() => {
    const map = new Map<string, string>();
    for (const project of projects ?? []) {
      if (!project.orphaned) map.set(project.encoded, project.path);
    }
    return map;
  }, [projects]);

  // Sessions always belong to the highlighted project, whichever panel has
  // focus. That is what keeps the hierarchy stable.
  useEffect(() => {
    let cancelled = false;
    setSessionsLoading(true);
    const load = async () => {
      if (!selectedItem) return [];
      if (selectedItem.kind === 'all') {
        return showArchived ? listAllArchivedSessions() : listAllSessions();
      }
      return showArchived
        ? listArchivedSessions(selectedItem.project.encoded)
        : listSessions(selectedItem.project.encoded);
    };
    load()
      .then(async (list) => {
        if (cancelled) return;
        setSessions(list);
        setLoadedKey(
          selectedItem?.kind === 'project'
            ? pendingKey(selectedItem.project.encoded, showArchived)
            : null,
        );
        setSessionIndex((i) => Math.min(i, Math.max(0, list.length - 1)));
        setSessionsLoading(false);
        const meta = await SessionMetadataService.getMany(list);
        if (!cancelled) setMetadata(meta);
      })
      .catch(() => {
        if (!cancelled) {
          setSessions([]);
          setSessionsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedItem, showArchived, refreshTick]);

  /**
   * Sorted session rows, then ranked when there is a query. Title sorting
   * reorders once metadata arrives, which is the same moment the rows stop
   * showing session ids, so what the user sees and what they asked for stay
   * in agreement.
   */
  const sessionRows = useMemo<Array<{ item: SessionEntry; highlights?: number[] }>>(() => {
    const sorted = ViewService.sortSessions(sessions, metadata, view.sessionSort);
    if (!sessionQuery.trim()) return sorted.map((item) => ({ item }));
    return SearchService.filterSessions(sorted, metadata, sessionQuery).map((result) => ({
      item: result.item,
      highlights: result.highlights[LABEL_FIELD],
    }));
  }, [sessions, metadata, sessionQuery, view.sessionSort]);

  const visibleSessions = useMemo(() => sessionRows.map((row) => row.item), [sessionRows]);

  const selectedSession =
    visibleSessions.length > 0
      ? visibleSessions[Math.min(sessionIndex, visibleSessions.length - 1)]
      : null;

  /** The centre panel follows focus: project summary, or session details. */
  const showSessionDetail = focus !== 'projects' && selectedSession !== null;

  // Analyze only what the centre panel is actually showing.
  useEffect(() => {
    setConversation(null);
    setDetailScroll(0);
    if (!selectedSession || !showSessionDetail) return;
    let cancelled = false;
    setConversationLoading(true);
    ConversationService.analyze(selectedSession)
      .then((result) => {
        if (!cancelled) setConversation(result);
      })
      .catch(() => {
        if (!cancelled) setConversation(null);
      })
      .finally(() => {
        if (!cancelled) setConversationLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSession?.file, showSessionDetail]);

  const runOp = useCallback(
    (title: string, fn: () => Promise<string[]>) => {
      setBusy(true);
      fn()
        .then((steps) => showOverlay(title, steps.join('\n')))
        .catch((error: Error) => showOverlay(`${title} failed`, error.message))
        .finally(() => {
          setBusy(false);
          refresh();
        });
    },
    [refresh, showOverlay],
  );

  // ---- Flows ----------------------------------------------------------

  const startMove = useCallback(
    (project: Project) => {
      open({
        kind: 'input',
        title: 'Move project',
        label: `New location for ${project.path}. An existing directory moves the project into it; ~ expands to home.`,
        onResult: (value) => {
          if (!value) return;
          const destination = expandHome(value);
          setBusy(true);
          MoveService.move({ source: project.path, destination, parents: true, dryRun: true })
            .then((plan) => {
              setBusy(false);
              open({
                kind: 'confirm',
                title: 'Confirm move',
                message: plan.steps.join('\n'),
                onResult: (ok) => {
                  if (!ok) return;
                  runOp('Move project', async () => {
                    const report = await MoveService.move({
                      source: project.path,
                      destination,
                      parents: true,
                    });
                    return [...report.steps, '', `Resume with: cd ${report.destination} && claude --continue`];
                  });
                },
              });
            })
            .catch((error: Error) => {
              setBusy(false);
              showOverlay('Move failed', error.message);
            });
        },
      });
    },
    [open, runOp, showOverlay],
  );

  const startRemove = useCallback(
    (project: Project) => {
      open({
        kind: 'confirm',
        title: 'Remove project',
        danger: true,
        message: `Permanently delete ${project.path}?\n\nThis removes the project directory, ${project.sessions} session file(s), archived sessions, and all history entries. A history.jsonl backup is created first, but project files are NOT recoverable.`,
        onResult: (ok) => {
          if (!ok) return;
          runOp('Remove project', async () => {
            const report = await ProjectService.remove({ path: project.path });
            return report.steps;
          });
        },
      });
    },
    [open, runOp],
  );

  const startPack = useCallback(
    (project: Project) => {
      open({
        kind: 'input',
        title: 'Pack project',
        label: `Archive path for ${project.path}`,
        initial: path.join(os.homedir(), `${path.basename(project.path)}.claudepack`),
        onResult: (value) => {
          if (!value) return;
          runOp('Pack project', async () => {
            const report = await PackService.pack({
              source: project.path,
              archive: expandHome(value),
            });
            return [...report.steps, '', `Unpack with: lazyclaude unpack ${report.archive} <destination>`];
          });
        },
      });
    },
    [open, runOp],
  );

  const startUnpack = useCallback(() => {
    open({
      kind: 'input',
      title: 'Unpack archive',
      label: 'Path to the .claudepack archive',
      onResult: (archiveValue) => {
        if (!archiveValue) return;
        const archive = expandHome(archiveValue);
        open({
          kind: 'input',
          title: 'Unpack destination',
          label: 'Directory to restore the project to (must not exist yet)',
          onResult: (destValue) => {
            if (!destValue) return;
            const destination = expandHome(destValue);
            open({
              kind: 'confirm',
              title: 'Confirm unpack',
              message: `Restore ${archive}\n  -> ${destination}\n\nSessions and history entries are rewritten for the new location.`,
              onResult: (ok) => {
                if (!ok) return;
                runOp('Unpack archive', async () => {
                  const report = await PackService.unpack({ archive, destination, parents: true });
                  return [...report.steps, '', `Resume with: cd ${report.destination} && claude --continue`];
                });
              },
            });
          },
        });
      },
    });
  }, [open, runOp]);

  const repairTo = useCallback(
    (from: string, to: string) => {
      setBusy(true);
      RepairService.repair({ from, to, dryRun: true })
        .then((plan) => {
          setBusy(false);
          if (plan.changes === 0) {
            showOverlay('Repair', plan.steps.join('\n'));
            return;
          }
          open({
            kind: 'confirm',
            title: 'Confirm repair',
            message: plan.steps.join('\n'),
            onResult: (ok) => {
              if (!ok) return;
              runOp('Repair references', async () => {
                const report = await RepairService.repair({ from, to });
                return report.steps;
              });
            },
          });
        })
        .catch((error: Error) => {
          setBusy(false);
          showOverlay('Repair failed', error.message);
        });
    },
    [open, runOp, showOverlay],
  );

  const chooseRepairTarget = useCallback(
    (from: string) => {
      setBusy(true);
      RepairService.findCandidates({ path: from, name: path.basename(from) })
        .catch(() => [] as string[])
        .then((candidates) => {
          setBusy(false);
          const MANUAL = 'Enter the new path manually…';
          open({
            kind: 'picker',
            title: `Where does ${path.basename(from)} live now?`,
            options: [...candidates, MANUAL],
            onResult: (value) => {
              if (!value) return;
              if (value === MANUAL) {
                open({
                  kind: 'input',
                  title: 'New project location',
                  label: `Current path of the project previously at ${from}`,
                  onResult: (manual) => {
                    if (!manual) return;
                    repairTo(from, expandHome(manual));
                  },
                });
                return;
              }
              repairTo(from, value);
            },
          });
        });
    },
    [open, repairTo],
  );

  const startRepair = useCallback(() => {
    const broken = (projects ?? []).filter((p) => !p.exists && !p.orphaned);
    if (broken.length === 0) {
      showOverlay('Repair', 'No broken references found. Everything looks good.');
      return;
    }
    if (selectedProject && !selectedProject.exists && !selectedProject.orphaned) {
      chooseRepairTarget(selectedProject.path);
      return;
    }
    open({
      kind: 'picker',
      title: `Broken references (${broken.length})`,
      options: broken.map((p) => p.path),
      onResult: (value) => {
        if (!value) return;
        chooseRepairTarget(value);
      },
    });
  }, [projects, selectedProject, chooseRepairTarget, open, showOverlay]);

  const startBackups = useCallback(() => {
    setBusy(true);
    BackupService.list()
      .then((backups: Backup[]) => {
        setBusy(false);
        const CREATE = 'Create a new backup now';
        open({
          kind: 'picker',
          title: `History backups (${backups.length})`,
          options: [
            CREATE,
            ...backups.map(
              (b) => `${b.name}  ${formatRelativeTime(b.createdAt)}  ${formatBytes(b.sizeBytes)}`,
            ),
          ],
          onResult: (value, index) => {
            if (value === null) return;
            if (index === 0) {
              runOp('Create backup', async () => {
                const file = await BackupService.create();
                return [file ? `Created backup: ${file}` : 'No history file to back up.'];
              });
              return;
            }
            const backup = backups[index - 1];
            open({
              kind: 'picker',
              title: backup.name,
              options: ['Restore this backup', 'Delete this backup'],
              onResult: (action) => {
                if (!action) return;
                if (action.startsWith('Restore')) {
                  open({
                    kind: 'confirm',
                    title: 'Restore backup',
                    message: `Replace history.jsonl with ${backup.name}? The current state is backed up first.`,
                    onResult: (ok) => {
                      if (!ok) return;
                      runOp('Restore backup', async () => {
                        const { preRestoreBackup } = await BackupService.restore(backup.file);
                        const steps = [`Restored history.jsonl from ${backup.name}`];
                        if (preRestoreBackup) {
                          steps.push(`Previous state saved as: ${path.basename(preRestoreBackup)}`);
                        }
                        return steps;
                      });
                    },
                  });
                } else {
                  open({
                    kind: 'confirm',
                    title: 'Delete backup',
                    danger: true,
                    message: `Delete ${backup.name}? This cannot be undone.`,
                    onResult: (ok) => {
                      if (!ok) return;
                      runOp('Delete backup', async () => {
                        await BackupService.delete(backup.file);
                        return [`Deleted ${backup.name}`];
                      });
                    },
                  });
                }
              },
            });
          },
        });
      })
      .catch((error: Error) => {
        setBusy(false);
        showOverlay('Backups', error.message);
      });
  }, [open, runOp, showOverlay]);

  const showInfo = useCallback(
    (project: Project) => {
      setBusy(true);
      ProjectService.info(project.orphaned ? project.encoded : project.path)
        .then((info) => {
          setBusy(false);
          showOverlay(
            `Info: ${shortenPath(info.path, home)}`,
            [
              `Project: ${info.path}`,
              `Encoded folder: ${info.encoded}`,
              `Project directory: ${info.projectExists ? 'exists' : 'missing'}`,
              ...(info.projectExists ? [`Project size: ${formatKb(info.projectSizeKb)}`] : []),
              `.claude settings: ${info.hasClaudeSettings ? 'found' : 'not found'}`,
              `Sessions: ${info.sessionCount} file(s), ${formatKb(info.sessionSizeKb)}` +
                (info.archivedCount > 0 ? ` (+${info.archivedCount} archived)` : ''),
              ...(info.newestSession ? [`Newest session: ${info.newestSession.toLocaleString()}`] : []),
              ...(info.oldestSession ? [`Oldest session: ${info.oldestSession.toLocaleString()}`] : []),
              `History entries: ${info.historyEntries.exact} (${info.historyEntries.nested} nested)`,
            ].join('\n'),
          );
        })
        .catch((error: Error) => {
          setBusy(false);
          showOverlay('Info failed', error.message);
        });
    },
    [home, showOverlay],
  );

  const sessionAction = useCallback(
    (kind: 'archive' | 'restore' | 'delete', session: SessionEntry) => {
      const label = metadata.get(session.file)?.title ?? session.id;
      const spec = {
        archive: {
          title: 'Archive session',
          message: `Archive "${label}"?\n\nIt moves to the Lazy Claude archive and disappears from Claude Code until restored.`,
          danger: false,
        },
        restore: {
          title: 'Restore session',
          message: `Restore "${label}" back into the Claude projects directory?`,
          danger: false,
        },
        delete: {
          title: 'Delete session',
          message: `Permanently delete "${label}"?\n\nThis removes the session file and cannot be undone.`,
          danger: true,
        },
      }[kind];
      open({
        kind: 'confirm',
        title: spec.title,
        message: spec.message,
        danger: spec.danger,
        onResult: (ok) => {
          if (!ok) return;
          setBusy(true);
          const run =
            kind === 'archive'
              ? archiveSession(session)
              : kind === 'restore'
                ? restoreSession(session)
                : deleteSession(session);
          run
            .then(() => setStatus(`${spec.title.split(' ')[0]}d ${session.id.slice(0, 8)}`))
            .catch((error: Error) => setStatus(`Error: ${error.message}`))
            .finally(() => {
              setBusy(false);
              refresh();
            });
        },
      });
    },
    [metadata, open, refresh],
  );

  const checkSession = useCallback((session: SessionEntry) => {
    setBusy(true);
    validateSession(session)
      .then((integrity) =>
        setStatus(
          `${session.id.slice(0, 8)}: ${integrity.validRecords}/${integrity.totalLines} valid` +
            (integrity.ok ? '' : ` (${integrity.invalidLines} invalid)`),
        ),
      )
      .catch((error: Error) => setStatus(`Error: ${error.message}`))
      .finally(() => setBusy(false));
  }, []);

  /**
   * Hand control to Claude Code. Everything is validated first so failures
   * surface as a dialog rather than a broken exit, and the dangerous mode
   * confirms before it leaves. The plan is recorded and the app exits; the
   * CLI entry point spawns the child once the terminal is restored.
   */
  const launchSession = useCallback(
    (mode: LaunchMode) => {
      const session = selectedSession;
      if (!session) return;
      const projectPath =
        selectedProject && !selectedProject.orphaned
          ? selectedProject.path
          : projectByEncoded.get(session.encoded);

      setBusy(true);
      LauncherService.prepare(session, projectPath, mode)
        .then((plan) => {
          setBusy(false);
          const title = metadata.get(session.file)?.title ?? session.id;
          const handOver = () => {
            LauncherService.request(plan);
            exit();
          };
          if (!mode.danger) {
            handOver();
            return;
          }
          open({
            kind: 'confirm',
            title: 'Resume without permission prompts',
            danger: true,
            message: `Resume "${title}" with --dangerously-skip-permissions?\n\nClaude Code will not ask before running commands or editing files in ${plan.cwd}.\n\n${plan.shell}`,
            onResult: (ok) => {
              if (ok) handOver();
            },
          });
        })
        .catch((error: Error) => {
          setBusy(false);
          const hint = error instanceof LaunchError && error.hint ? `\n\n${error.hint}` : '';
          showOverlay('Cannot resume session', `${error.message}${hint}`);
        });
    },
    [selectedSession, selectedProject, projectByEncoded, metadata, exit, open, showOverlay],
  );

  const startPrune = useCallback(() => {
    setBusy(true);
    DiagnosticsService.pruneOrphans(true)
      .then((preview) => {
        setBusy(false);
        if (preview.removed.length === 0) {
          showOverlay('Prune', preview.text);
          return;
        }
        open({
          kind: 'confirm',
          title: 'Prune orphaned session folders',
          danger: true,
          message: preview.text,
          onResult: (ok) => {
            if (!ok) return;
            runOp('Prune', async () => (await DiagnosticsService.pruneOrphans(false)).steps);
          },
        });
      })
      .catch((error: Error) => {
        setBusy(false);
        showOverlay('Prune failed', error.message);
      });
  }, [open, runOp, showOverlay]);

  const runDiagnostics = useCallback(() => {
    setBusy(true);
    DiagnosticsService.doctor()
      .then((text) => showOverlay('Diagnostics', text))
      .finally(() => setBusy(false));
  }, [showOverlay]);

  const rescanMetadata = useCallback(() => {
    setBusy(true);
    SessionMetadataService.clearCache()
      .then(() => {
        setStatus('Metadata cache cleared, rescanning…');
        refresh();
      })
      .finally(() => setBusy(false));
  }, [refresh]);

  /**
   * Read from disk rather than from the search index. The index is built in
   * the background and may still be filling, and a storage report that
   * silently under-reports is worse than one that takes a moment.
   */
  const showStatistics = useCallback(() => {
    setBusy(true);
    StatsService.collect(home)
      .then((stats) => showOverlay('Workspace statistics', StatsService.format(stats)))
      .catch((error: Error) => showOverlay('Workspace statistics failed', error.message))
      .finally(() => setBusy(false));
  }, [home, showOverlay]);

  const toggleArchived = useCallback(() => {
    setShowArchived((value) => !value);
    setSessionIndex(0);
  }, []);

  const healthCheck = useCallback(() => {
    setBusy(true);
    DiagnosticsService.healthCheck()
      .then((report) => showOverlay('Health check', report.text))
      .finally(() => setBusy(false));
  }, [showOverlay]);

  // ---- Workspace actions ----------------------------------------------

  /**
   * The global half of the two command surfaces, rebuilt whenever the view
   * or a handler changes because each action's `active` flag and closure
   * describe the state at the moment it was built. The palette gets a copy
   * when it opens.
   */
  const workspaceActions = useMemo(
    () =>
      ActionRegistry.list({
        view,
        showArchived,
        setView,
        handlers: {
          rescan: refresh,
          refreshMetadata: rescanMetadata,
          repairReferences: startRepair,
          healthCheck,
          diagnostics: runDiagnostics,
          backupManager: startBackups,
          unpackArchive: startUnpack,
          pruneOrphans: startPrune,
          statistics: showStatistics,
          toggleArchived,
        },
      }),
    [
      view,
      showArchived,
      refresh,
      rescanMetadata,
      startRepair,
      healthCheck,
      runDiagnostics,
      startBackups,
      startUnpack,
      startPrune,
      showStatistics,
      toggleArchived,
    ],
  );

  const runWorkspaceAction = useCallback(
    (id: string) => {
      const action = workspaceActions.find((entry) => entry.id === id);
      if (!action) {
        setStatus('That action is no longer available.');
        return;
      }
      action.run();
    },
    [workspaceActions],
  );

  /**
   * Sort popup for whichever list has focus. It reuses the picker overlay
   * rather than introducing a dialog kind, and its options come from the
   * same tables the palette's sorting actions read.
   */
  const openSortPicker = useCallback(() => {
    const onSessions = focus !== 'projects';
    if (onSessions) {
      const activeId = ViewService.sessionSortOption(view.sessionSort).id;
      open({
        kind: 'picker',
        title: 'Sort sessions',
        options: SESSION_SORTS.map(
          (option) => `${option.label}${option.id === activeId ? '  · active' : ''}`,
        ),
        onResult: (value, index) => {
          const chosen = SESSION_SORTS[index];
          if (value === null || !chosen) return;
          setView((current) => ({ ...current, sessionSort: chosen.sort }));
        },
      });
      return;
    }
    const activeId = ViewService.projectSortOption(view.projectSort).id;
    open({
      kind: 'picker',
      title: 'Sort projects',
      options: PROJECT_SORTS.map(
        (option) => `${option.label}${option.id === activeId ? '  · active' : ''}`,
      ),
      onResult: (value, index) => {
        const chosen = PROJECT_SORTS[index];
        if (value === null || !chosen) return;
        setView((current) => ({ ...current, projectSort: chosen.sort }));
      },
    });
  }, [focus, open, view.sessionSort, view.projectSort]);

  // ---- Contextual actions ---------------------------------------------

  /**
   * The contextual half of the two command surfaces. Everything here acts
   * on the highlighted project or session; anything that would run the same
   * way with nothing selected lives in the palette's Actions tab instead.
   */
  const categories = useMemo(
    () =>
      buildActionCategories({
        focus,
        project: selectedProject,
        session: selectedSession,
        handlers: {
          resume: () => launchSession(LAUNCH_MODES.resume),
          resumeDangerous: () => launchSession(LAUNCH_MODES.resumeDangerous),
          archiveSession: () => selectedSession && sessionAction('archive', selectedSession),
          restoreSession: () => selectedSession && sessionAction('restore', selectedSession),
          deleteSession: () => selectedSession && sessionAction('delete', selectedSession),
          checkIntegrity: () => selectedSession && checkSession(selectedSession),
          moveProject: () => selectedProject && startMove(selectedProject),
          repairReferences: startRepair,
          packProject: () => selectedProject && startPack(selectedProject),
          projectInfo: () => selectedProject && showInfo(selectedProject),
          removeProject: () => selectedProject && startRemove(selectedProject),
        },
      }),
    [
      focus,
      selectedProject,
      selectedSession,
      launchSession,
      sessionAction,
      checkSession,
      startMove,
      startRepair,
      startPack,
      showInfo,
      startRemove,
    ],
  );

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
      // Without this the planned index would point into the full project
      // list while the rows are still filtered, and a jump to a project the
      // filter hides could not resolve at all.
      clearProjectFilter: () => setView((current) => ({ ...current, projectFilter: 'none' })),
    }),
    [],
  );

  const jumpTo = useJumpTarget({
    items: allProjectItems,
    sessions: visibleSessions,
    sessionsLoading,
    loadedKey,
    currentKey,
    actions: jumpActions,
  });

  /** The palette selects; deciding what a selection means happens here. */
  const handleSelect = useCallback(
    (target: SelectTarget) => {
      if (target.kind === 'action') {
        runWorkspaceAction(target.id);
        return;
      }
      jumpTo(target);
    },
    [jumpTo, runWorkspaceAction],
  );

  const openPalette = useCallback(
    () => open({ kind: 'palette', actions: workspaceActions, onSelect: handleSelect }),
    [open, handleSelect, workspaceActions],
  );

  // ---- Keyboard --------------------------------------------------------

  // Panels only listen while no overlay is open and nothing is running.
  useAppInput(
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
        const onProjects = focus === 'projects';
        const setQuery = onProjects ? setProjectQuery : setSessionQuery;
        const resetIndex = () => (onProjects ? setProjectIndex(0) : setSessionIndex(0));

        if (key.escape) {
          setQuery('');
          setSearching(false);
          resetIndex();
        } else if (key.return) {
          // Keep the filter, hand the keyboard back to the list. From the
          // project list that also steps down into its sessions.
          setSearching(false);
          if (onProjects) setFocus('sessions');
        } else if (key.upArrow) {
          if (onProjects) setProjectIndex((i) => Math.max(0, i - 1));
          else setSessionIndex((i) => Math.max(0, i - 1));
        } else if (key.downArrow) {
          if (onProjects) setProjectIndex((i) => Math.min(projectItems.length - 1, i + 1));
          else setSessionIndex((i) => Math.min(Math.max(0, visibleSessions.length - 1), i + 1));
        } else if (key.tab) {
          setSearching(false);
          setFocus(FOCUS_ORDER[(FOCUS_ORDER.indexOf(focus) + 1) % FOCUS_ORDER.length]);
        } else if (key.ctrl && (input === 'u' || input === 'w')) {
          setQuery('');
          resetIndex();
        } else if (key.backspace || key.delete) {
          setQuery((q) => q.slice(0, -1));
          resetIndex();
        } else if (input && !key.ctrl && !key.meta) {
          setQuery((q) => q + input);
          resetIndex();
        }
        return;
      }

      if (input === 'q') {
        exit();
        return;
      }
      if (input === '?') {
        showOverlay('Help', HELP_TEXT);
        return;
      }
      if (input === 'x') {
        open({
          kind: 'actions',
          title: focus === 'projects' ? 'Project actions' : 'Session actions',
          categories,
        });
        return;
      }
      if (input === '/') {
        setSearching(true);
        return;
      }
      if (input === 's') {
        openSortPicker();
        return;
      }
      if (input === 'R') {
        setStatus('Refreshing…');
        refresh();
        return;
      }
      if (input === 't') {
        setShowArchived((v) => !v);
        setSessionIndex(0);
        return;
      }

      // Tab cycles panels. In the details panel it also switches tabs, so
      // shift+tab is reserved for stepping the panel focus backwards.
      if (key.tab && !key.shift) {
        if (focus === 'details') {
          setDetailTab((t) => DETAIL_TABS[(DETAIL_TABS.indexOf(t) + 1) % DETAIL_TABS.length]);
          setDetailScroll(0);
        } else {
          setFocus(FOCUS_ORDER[(FOCUS_ORDER.indexOf(focus) + 1) % FOCUS_ORDER.length]);
        }
        return;
      }
      if (key.tab && key.shift) {
        setFocus(FOCUS_ORDER[(FOCUS_ORDER.indexOf(focus) + FOCUS_ORDER.length - 1) % FOCUS_ORDER.length]);
        return;
      }
      if (/^[1-4]$/.test(input)) {
        setDetailTab(DETAIL_TABS[Number.parseInt(input, 10) - 1]);
        setDetailScroll(0);
        return;
      }
      if (input === 'J') {
        setDetailScroll((s) => s + 1);
        return;
      }
      if (input === 'K') {
        setDetailScroll((s) => Math.max(0, s - 1));
        return;
      }

      // Only the frequent per-item actions keep a global shortcut. Every
      // management operation is reached through the palette (x), which is
      // what keeps the footer about navigation.
      if (QUICK_KEYS.has(input)) {
        const shortcut = findShortcut(categories, input);
        if (shortcut) {
          shortcut.run();
          return;
        }
      }

      if (key.escape) {
        // Undo whatever is narrowing the view before moving anywhere: the
        // query first, then the project filter. State that survives an
        // escape is how a filtered list starts looking like a bug.
        const query = focus === 'projects' ? projectQuery : sessionQuery;
        if (focus !== 'details' && query) {
          if (focus === 'projects') {
            setProjectQuery('');
            setProjectIndex(0);
          } else {
            setSessionQuery('');
            setSessionIndex(0);
          }
          return;
        }
        if (focus === 'projects' && view.projectFilter !== 'none') {
          setView((current) => ({ ...current, projectFilter: 'none' }));
          setProjectIndex(0);
          return;
        }
        setFocus((f) => (f === 'details' ? 'sessions' : 'projects'));
        return;
      }

      if (focus === 'projects') {
        if (key.upArrow || input === 'k') {
          setProjectIndex((i) => Math.max(0, i - 1));
          setSessionIndex(0);
        } else if (key.downArrow || input === 'j') {
          setProjectIndex((i) => Math.min(projectItems.length - 1, i + 1));
          setSessionIndex(0);
        } else if (key.return || key.rightArrow || input === 'l') {
          setFocus('sessions');
        }
        return;
      }

      if (focus === 'sessions') {
        if (key.upArrow || input === 'k') {
          setSessionIndex((i) => Math.max(0, i - 1));
        } else if (key.downArrow || input === 'j') {
          setSessionIndex((i) => Math.min(Math.max(0, visibleSessions.length - 1), i + 1));
        } else if (key.leftArrow || input === 'h') {
          setFocus('projects');
        } else if (key.return || key.rightArrow || input === 'l') {
          setFocus('details');
        }
        return;
      }

      // Details panel
      if (key.upArrow || input === 'k') setDetailScroll((s) => Math.max(0, s - 1));
      else if (key.downArrow || input === 'j') setDetailScroll((s) => s + 1);
      else if (key.leftArrow || input === 'h') setFocus('sessions');
    },
    !busy,
  );

  // ---- Layout ----------------------------------------------------------

  const mainHeight = rows - 1;
  const leftWidth = Math.min(56, Math.max(30, Math.floor(columns * 0.36)));
  // Panel borders take 2 columns, the row's own text starts at column 0.
  const rowWidth = Math.max(10, leftWidth - 2);
  // The project list keeps a little under half the column so both lists
  // stay useful; sessions get the remainder.
  const projectsHeight = Math.max(8, Math.floor(mainHeight * 0.45));
  const sessionsHeight = mainHeight - projectsHeight;
  // Each list panel spends 5 lines on chrome: two borders, the panel
  // title, the always-visible search row, and the "n-m of N" counter.
  // Overshooting here makes the panel overflow, and Yoga then collapses
  // row lines to zero height instead of clipping.
  const LIST_CHROME = 5;
  const projectsViewport = Math.max(2, projectsHeight - LIST_CHROME);
  const sessionsViewport = Math.max(2, sessionsHeight - LIST_CHROME);
  const detailHeight = mainHeight - 4;

  const projectLabel = selectedProject
    ? shortenPath(selectedProject.orphaned ? selectedProject.encoded : selectedProject.path, home)
    : 'all projects';

  // An active filter is named in the panel title, so a narrowed list can
  // never look like a workspace that lost its projects.
  const activeFilter = ViewService.filterOption(view.projectFilter);
  const projectsTitle = activeFilter
    ? `Projects (${projectRows.length} of ${(projects ?? []).length} · ${activeFilter.badge})`
    : `Projects (${(projects ?? []).length})`;

  // The inspector header is a real tab bar now, so the panel title names
  // what is being inspected instead of doubling as navigation.
  const detailTitle = showSessionDetail
    ? `Session: ${metadata.get(selectedSession!.file)?.title ?? selectedSession!.id}`
    : `Project: ${projectLabel}`;
  const detailInnerWidth = Math.max(10, columns - leftWidth - 4);

  // The footer is about navigation. Operations are discovered in the
  // action palette, so only the constant per-item shortcuts appear here.
  const bindings: Array<[string, string]> =
    focus === 'projects'
      ? [
          ['↑↓', 'projects'],
          ['enter', 'sessions'],
          ['/', 'search'],
          ['s', 'sort'],
          [KEYS.commandPalette.label, 'commands'],
          ['x', 'actions'],
          ['?', 'help'],
          ['q', 'quit'],
        ]
      : focus === 'sessions'
        ? [
            ['↑↓', 'sessions'],
            ['e', 'resume'],
            ['enter', 'details'],
            ['/', 'search'],
            ['s', 'sort'],
            [KEYS.commandPalette.label, 'commands'],
            ['x', 'actions'],
            ['?', 'help'],
            ['q', 'quit'],
          ]
        : [
            ['↑↓', 'scroll'],
            ['tab', 'next tab'],
            ['1-4', 'tab'],
            [KEYS.commandPalette.label, 'commands'],
            ['esc', 'sessions'],
            ['x', 'actions'],
            ['?', 'help'],
            ['q', 'quit'],
          ];

  const rootWidth = columns;

  return (
    // position relative: the positioning context the overlay host
    // absolutely positions itself against.
    <Box position="relative" flexDirection="column" width={rootWidth} height={rows}>
      <Box height={mainHeight}>
        {/* Left column: projects on top, that project's sessions below. */}
        <Box flexDirection="column" width={leftWidth} flexShrink={0}>
          <Panel title={projectsTitle} focused={focus === 'projects'} height={projectsHeight}>
            <SearchRow
              active={searching && focus === 'projects'}
              query={projectQuery}
              placeholder="Search projects (/)"
              // The "All sessions" row is a scope switch, not a project, so
              // counting it would put the tally above the total.
              matches={projectItems.filter((item) => item.kind === 'project').length}
              total={(projects ?? []).length}
              width={rowWidth}
              sort={ViewService.projectSortOption(view.projectSort).badge}
            />
            {loadError && projects === null ? (
              <Box paddingX={1}>
                <Text color="red" wrap="wrap">
                  {loadError}
                </Text>
              </Box>
            ) : projects === null ? (
              <Box paddingX={1}>
                <Text dimColor>Scanning projects…</Text>
              </Box>
            ) : (
              <ListView
                items={projectRows}
                selectedIndex={projectIndex}
                height={projectsViewport}
                focused={focus === 'projects'}
                linesPerItem={2}
                emptyMessage={`No projects match "${projectQuery}"`}
                renderItem={(row, selected) =>
                  row.item.kind === 'all' ? (
                    <AllSessionsRow
                      selected={selected}
                      focused={focus === 'projects'}
                      count={(projects ?? []).reduce((sum, p) => sum + p.sessions, 0)}
                      width={rowWidth}
                    />
                  ) : (
                    <ProjectRow
                      project={row.item.project}
                      selected={selected}
                      focused={focus === 'projects'}
                      highlights={row.highlights}
                      home={home}
                      width={rowWidth}
                    />
                  )
                }
              />
            )}
          </Panel>

          <Panel
            title={`Sessions${showArchived ? ' (archived)' : ''}: ${projectLabel}`}
            focused={focus === 'sessions'}
            height={sessionsHeight}
          >
            <SearchRow
              active={searching && focus === 'sessions'}
              query={sessionQuery}
              placeholder="Search sessions (/)"
              matches={visibleSessions.length}
              total={sessions.length}
              width={rowWidth}
              sort={ViewService.sessionSortOption(view.sessionSort).badge}
            />
            {sessionsLoading ? (
              <Box paddingX={1}>
                <Text dimColor>Loading sessions…</Text>
              </Box>
            ) : (
              <ListView
                items={sessionRows}
                selectedIndex={sessionIndex}
                height={sessionsViewport}
                focused={focus === 'sessions'}
                linesPerItem={2}
                emptyMessage={
                  sessionQuery
                    ? `No sessions match "${sessionQuery}"`
                    : showArchived
                      ? 'No archived sessions'
                      : 'No sessions'
                }
                renderItem={(row, selected) => (
                  <SessionRow
                    session={row.item}
                    metadata={metadata.get(row.item.file)}
                    selected={selected}
                    focused={focus === 'sessions'}
                    highlights={row.highlights}
                    showProject={selectedItem?.kind === 'all'}
                    home={home}
                    width={rowWidth}
                  />
                )}
              />
            )}
          </Panel>
        </Box>

        {/* Centre column follows focus: project summary or session details. */}
        <Box flexDirection="column" flexGrow={1}>
          <Panel title={detailTitle} focused={focus === 'details'} height={mainHeight}>
            {showSessionDetail && selectedSession ? (
              <>
                <TabBar
                  tabs={DETAIL_TAB_DEFS}
                  active={detailTab}
                  width={detailInnerWidth}
                />
                <SessionDetail
                  session={selectedSession}
                  metadata={metadata.get(selectedSession.file)}
                  conversation={conversation}
                  loading={conversationLoading}
                  tab={detailTab}
                  home={home}
                  height={detailHeight - 2}
                  scroll={detailScroll}
                  projectPath={
                    selectedProject && !selectedProject.orphaned
                      ? selectedProject.path
                      : projectByEncoded.get(selectedSession.encoded)
                  }
                />
              </>
            ) : (
              <ProjectDetail
                project={selectedProject}
                sessions={sessions}
                metadata={metadata}
                loading={sessionsLoading}
                projects={projects}
                home={home}
                height={detailHeight}
              />
            )}
          </Panel>
        </Box>
      </Box>
      <HelpBar bindings={bindings} status={busy ? 'Working…' : status} />

      {/* Last sibling: Ink composites in order, so overlays draw on top. */}
      <OverlayHost />
    </Box>
  );
}
