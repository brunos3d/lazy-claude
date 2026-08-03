import React, { useCallback, useEffect, useMemo, useState } from 'react';
import os from 'node:os';
import path from 'node:path';
import { Box, Text, useApp, useInput } from 'ink';
import { DiscoveryService, type Project } from '../services/DiscoveryService.js';
import { DiagnosticsService } from '../services/DiagnosticsService.js';
import { ProjectService } from '../services/ProjectService.js';
import { MoveService } from '../services/MoveService.js';
import { RepairService } from '../services/RepairService.js';
import { PackService } from '../services/PackService.js';
import { BackupService, type Backup } from '../services/BackupService.js';
import { SearchService } from '../services/SearchService.js';
import { SessionMetadataService, type SessionMetadata } from '../services/SessionMetadataService.js';
import { ConversationService, type Conversation } from '../services/ConversationService.js';
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
import { SearchBar } from './SearchBar.js';
import { ActionMenu, type Action } from './ActionMenu.js';
import { AllSessionsRow, ProjectRow, SessionRow } from './rows.js';
import { DETAIL_TABS, SessionDetail, type DetailTab } from './SessionDetail.js';
import { ProjectDetail } from './ProjectDetail.js';
import { useTerminalSize } from './useTerminalSize.js';
import { ConfirmDialog, InputDialog, OverlayView, SelectDialog, type Modal } from './modals.js';

type View = 'projects' | 'sessions';

type ProjectItem = { kind: 'all' } | { kind: 'project'; project: Project };

export interface AppProps {
  /** Project to open directly, from `lazy-claude <path>`. */
  initialProject?: string;
}

const HELP_TEXT = `Lazy Claude

Navigation
  ↑/k ↓/j        move selection
  enter          open project sessions / analyze session
  esc            back to the project list
  tab or 1..4    switch detail tab (overview, conversation, timeline, files)
  J / K          scroll the detail panel
  /              search the current list
  x              contextual action menu

Projects
  enter          browse sessions
  m              move project and migrate every reference
  F              repair broken references
  D              remove project and all session data
  p              pack into a .claudepack archive
  i              project info

Sessions
  a              archive session (reversible, hides it from Claude Code)
  r              restore an archived session
  d              delete session permanently
  c              check session file integrity
  t              toggle live / archived sessions

Global
  U              unpack a .claudepack archive
  B              backup manager
  V              health check
  P              prune orphaned session folders
  R              refresh (rescan projects and sessions)
  ?              this help
  q              quit

Titles come from the same metadata Claude Code's resume picker uses.
Sessions whose title is dimmed had it inferred from the opening prompt.`;

function expandHome(input: string): string {
  if (input === '~') return os.homedir();
  if (input.startsWith('~/') || input.startsWith('~\\')) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

export function App({ initialProject }: AppProps) {
  const { exit } = useApp();
  const { columns, rows } = useTerminalSize();
  const home = os.homedir();

  const [projects, setProjects] = useState<Project[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<View>('projects');
  const [projectIndex, setProjectIndex] = useState(0);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [sessionIndex, setSessionIndex] = useState(0);
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [metadata, setMetadata] = useState<Map<string, SessionMetadata>>(new Map());
  const [showArchived, setShowArchived] = useState(false);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [detailTab, setDetailTab] = useState<DetailTab>('overview');
  const [detailScroll, setDetailScroll] = useState(0);
  const [query, setQuery] = useState('');
  const [searchActive, setSearchActive] = useState(false);
  const [modals, setModals] = useState<Modal[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [status, setStatus] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [autoOpened, setAutoOpened] = useState(false);

  const refresh = useCallback(() => setRefreshTick((t) => t + 1), []);
  const push = useCallback((modal: Modal) => setModals((s) => [...s, modal]), []);
  const pop = useCallback(() => setModals((s) => s.slice(0, -1)), []);
  const showOverlay = useCallback(
    (title: string, body: string) => setModals([{ kind: 'overlay', title, body }]),
    [],
  );

  // Discover projects.
  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    DiscoveryService.discoverProjects()
      .then((list) => {
        if (cancelled) return;
        list.sort((a, b) => b.lastActivity - a.lastActivity);
        setProjects(list);
      })
      .catch((error: Error) => {
        if (!cancelled) setLoadError(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshTick]);

  const allProjectItems = useMemo<ProjectItem[]>(() => {
    const items: ProjectItem[] = [{ kind: 'all' }];
    for (const project of projects ?? []) items.push({ kind: 'project', project });
    return items;
  }, [projects]);

  const projectItems = useMemo<ProjectItem[]>(() => {
    if (view !== 'projects' || !query.trim()) return allProjectItems;
    return allProjectItems.filter(
      (item) => item.kind === 'all' || SearchService.matchesProject(item.project, query),
    );
  }, [allProjectItems, query, view]);

  // Open straight into a project when launched with a path.
  useEffect(() => {
    if (autoOpened || !initialProject || !projects) return;
    setAutoOpened(true);
    const match = projects.find((p) => p.path === initialProject);
    if (!match) return;
    setActiveProject(match);
    setView('sessions');
    const index = allProjectItems.findIndex(
      (item) => item.kind === 'project' && item.project.path === match.path,
    );
    if (index >= 0) setProjectIndex(index);
  }, [autoOpened, initialProject, projects, allProjectItems]);

  /** Encoded folder to current project path, for sessions shown out of context. */
  const projectByEncoded = useMemo(() => {
    const map = new Map<string, string>();
    for (const project of projects ?? []) {
      if (!project.orphaned) map.set(project.encoded, project.path);
    }
    return map;
  }, [projects]);

  const highlightedItem = projectItems[Math.min(projectIndex, projectItems.length - 1)] ?? null;
  const highlightedProject = highlightedItem?.kind === 'project' ? highlightedItem.project : null;

  /** The project whose sessions the right side is about. */
  const scopeProject = view === 'sessions' ? activeProject : highlightedProject;

  // Load sessions for the current scope.
  useEffect(() => {
    let cancelled = false;
    setSessionsLoading(true);
    const load = async () => {
      if (view === 'sessions') {
        if (!activeProject) {
          return showArchived ? listAllArchivedSessions() : listAllSessions();
        }
        return showArchived
          ? listArchivedSessions(activeProject.encoded)
          : listSessions(activeProject.encoded);
      }
      // Projects view: preview the highlighted project's sessions.
      if (!highlightedProject) {
        return showArchived ? listAllArchivedSessions() : listAllSessions();
      }
      return showArchived
        ? listArchivedSessions(highlightedProject.encoded)
        : listSessions(highlightedProject.encoded);
    };
    load()
      .then(async (list) => {
        if (cancelled) return;
        setSessions(list);
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
  }, [view, activeProject, highlightedProject, showArchived, refreshTick]);

  const visibleSessions = useMemo(() => {
    if (view !== 'sessions' || !query.trim()) return sessions;
    return SearchService.filterSessions(
      sessions,
      metadata,
      activeProject?.path ?? '',
      query,
    );
  }, [sessions, metadata, query, view, activeProject]);

  const selectedSession =
    view === 'sessions' && visibleSessions.length > 0
      ? visibleSessions[Math.min(sessionIndex, visibleSessions.length - 1)]
      : null;

  // Deep-analyze the selected session for the detail panel.
  useEffect(() => {
    setConversation(null);
    setDetailScroll(0);
    if (!selectedSession) return;
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
  }, [selectedSession?.file]);

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
      push({
        kind: 'input',
        title: 'Move project',
        label: `New location for ${project.path}. An existing directory moves the project into it; ~ expands to home.`,
        onResult: (value) => {
          pop();
          if (!value) return;
          const destination = expandHome(value);
          setBusy(true);
          MoveService.move({ source: project.path, destination, parents: true, dryRun: true })
            .then((plan) => {
              setBusy(false);
              push({
                kind: 'confirm',
                title: 'Confirm move',
                message: plan.steps.join('\n'),
                onResult: (ok) => {
                  pop();
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
    [pop, push, runOp, showOverlay],
  );

  const startRemove = useCallback(
    (project: Project) => {
      push({
        kind: 'confirm',
        title: 'Remove project',
        danger: true,
        message: `Permanently delete ${project.path}?\n\nThis removes the project directory, ${project.sessions} session file(s), archived sessions, and all history entries. A history.jsonl backup is created first, but project files are NOT recoverable.`,
        onResult: (ok) => {
          pop();
          if (!ok) return;
          runOp('Remove project', async () => {
            const report = await ProjectService.remove({ path: project.path });
            return report.steps;
          });
        },
      });
    },
    [pop, push, runOp],
  );

  const startPack = useCallback(
    (project: Project) => {
      push({
        kind: 'input',
        title: 'Pack project',
        label: `Archive path for ${project.path}`,
        initial: path.join(os.homedir(), `${path.basename(project.path)}.claudepack`),
        onResult: (value) => {
          pop();
          if (!value) return;
          runOp('Pack project', async () => {
            const report = await PackService.pack({
              source: project.path,
              archive: expandHome(value),
            });
            return [...report.steps, '', `Unpack with: lazy-claude unpack ${report.archive} <destination>`];
          });
        },
      });
    },
    [pop, push, runOp],
  );

  const startUnpack = useCallback(() => {
    push({
      kind: 'input',
      title: 'Unpack archive',
      label: 'Path to the .claudepack archive',
      onResult: (archiveValue) => {
        pop();
        if (!archiveValue) return;
        const archive = expandHome(archiveValue);
        push({
          kind: 'input',
          title: 'Unpack destination',
          label: 'Directory to restore the project to (must not exist yet)',
          onResult: (destValue) => {
            pop();
            if (!destValue) return;
            const destination = expandHome(destValue);
            push({
              kind: 'confirm',
              title: 'Confirm unpack',
              message: `Restore ${archive}\n  -> ${destination}\n\nSessions and history entries are rewritten for the new location.`,
              onResult: (ok) => {
                pop();
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
  }, [pop, push, runOp]);

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
          push({
            kind: 'confirm',
            title: 'Confirm repair',
            message: plan.steps.join('\n'),
            onResult: (ok) => {
              pop();
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
    [pop, push, runOp, showOverlay],
  );

  const chooseRepairTarget = useCallback(
    (from: string) => {
      setBusy(true);
      RepairService.findCandidates({ path: from, name: path.basename(from) })
        .catch(() => [] as string[])
        .then((candidates) => {
          setBusy(false);
          const MANUAL = 'Enter the new path manually…';
          push({
            kind: 'select',
            title: `Where does ${path.basename(from)} live now?`,
            options: [...candidates, MANUAL],
            onResult: (value) => {
              pop();
              if (!value) return;
              if (value === MANUAL) {
                push({
                  kind: 'input',
                  title: 'New project location',
                  label: `Current path of the project previously at ${from}`,
                  onResult: (manual) => {
                    pop();
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
    [pop, push, repairTo],
  );

  const startRepair = useCallback(() => {
    const broken = (projects ?? []).filter((p) => !p.exists && !p.orphaned);
    if (broken.length === 0) {
      showOverlay('Repair', 'No broken references found. Everything looks good.');
      return;
    }
    const target = highlightedProject ?? activeProject;
    if (target && !target.exists && !target.orphaned) {
      chooseRepairTarget(target.path);
      return;
    }
    push({
      kind: 'select',
      title: `Broken references (${broken.length})`,
      options: broken.map((p) => p.path),
      onResult: (value) => {
        pop();
        if (!value) return;
        chooseRepairTarget(value);
      },
    });
  }, [projects, highlightedProject, activeProject, chooseRepairTarget, pop, push, showOverlay]);

  const startBackups = useCallback(() => {
    setBusy(true);
    BackupService.list()
      .then((backups: Backup[]) => {
        setBusy(false);
        const CREATE = 'Create a new backup now';
        push({
          kind: 'select',
          title: `History backups (${backups.length})`,
          options: [
            CREATE,
            ...backups.map(
              (b) => `${b.name}  ${formatRelativeTime(b.createdAt)}  ${formatBytes(b.sizeBytes)}`,
            ),
          ],
          onResult: (value, index) => {
            pop();
            if (value === null) return;
            if (index === 0) {
              runOp('Create backup', async () => {
                const file = await BackupService.create();
                return [file ? `Created backup: ${file}` : 'No history file to back up.'];
              });
              return;
            }
            const backup = backups[index - 1];
            push({
              kind: 'select',
              title: backup.name,
              options: ['Restore this backup', 'Delete this backup'],
              onResult: (action) => {
                pop();
                if (!action) return;
                if (action.startsWith('Restore')) {
                  push({
                    kind: 'confirm',
                    title: 'Restore backup',
                    message: `Replace history.jsonl with ${backup.name}? The current state is backed up first.`,
                    onResult: (ok) => {
                      pop();
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
                  push({
                    kind: 'confirm',
                    title: 'Delete backup',
                    danger: true,
                    message: `Delete ${backup.name}? This cannot be undone.`,
                    onResult: (ok) => {
                      pop();
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
  }, [pop, push, runOp, showOverlay]);

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
      const spec = {
        archive: {
          title: 'Archive session',
          message: `Archive "${metadata.get(session.file)?.title ?? session.id}"?\n\nIt moves to the Lazy Claude archive and disappears from Claude Code until restored.`,
          danger: false,
        },
        restore: {
          title: 'Restore session',
          message: `Restore "${metadata.get(session.file)?.title ?? session.id}" back into the Claude projects directory?`,
          danger: false,
        },
        delete: {
          title: 'Delete session',
          message: `Permanently delete "${metadata.get(session.file)?.title ?? session.id}"?\n\nThis removes the session file and cannot be undone.`,
          danger: true,
        },
      }[kind];
      push({
        kind: 'confirm',
        title: spec.title,
        message: spec.message,
        danger: spec.danger,
        onResult: (ok) => {
          pop();
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
    [metadata, pop, push, refresh],
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

  const startPrune = useCallback(() => {
    setBusy(true);
    DiagnosticsService.pruneOrphans(true)
      .then((preview) => {
        setBusy(false);
        if (preview.removed.length === 0) {
          showOverlay('Prune', preview.text);
          return;
        }
        push({
          kind: 'confirm',
          title: 'Prune orphaned session folders',
          danger: true,
          message: preview.text,
          onResult: (ok) => {
            pop();
            if (!ok) return;
            runOp('Prune', async () => (await DiagnosticsService.pruneOrphans(false)).steps);
          },
        });
      })
      .catch((error: Error) => {
        setBusy(false);
        showOverlay('Prune failed', error.message);
      });
  }, [pop, push, runOp, showOverlay]);

  const openProject = useCallback((item: ProjectItem) => {
    setActiveProject(item.kind === 'all' ? null : item.project);
    setView('sessions');
    setSessionIndex(0);
    setQuery('');
    setSearchActive(false);
  }, []);

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

  // ---- Contextual actions ---------------------------------------------

  const actions = useMemo<Action[]>(() => {
    const list: Action[] = [];
    const project = scopeProject;

    if (view === 'projects') {
      list.push({
        key: 'enter',
        label: 'Browse sessions',
        description: 'Open the session list for this project',
        run: () => highlightedItem && openProject(highlightedItem),
      });
    }
    if (project) {
      list.push(
        {
          key: 'm',
          label: 'Move project',
          description: 'Relocate and migrate every session reference',
          run: () => startMove(project),
          disabled: !project.exists,
          disabledReason: 'project directory is missing',
        },
        {
          key: 'F',
          label: 'Repair references',
          description: 'Relink sessions after a manual move',
          run: startRepair,
        },
        {
          key: 'p',
          label: 'Pack project',
          description: 'Archive project and sessions into .claudepack',
          run: () => startPack(project),
          disabled: !project.exists,
          disabledReason: 'project directory is missing',
        },
        {
          key: 'i',
          label: 'Project info',
          description: 'Sizes, session counts, history entries',
          run: () => showInfo(project),
        },
        {
          key: 'D',
          label: 'Remove project',
          description: 'Delete the project and all session data',
          run: () => startRemove(project),
          disabled: !project.exists,
          disabledReason: 'project directory is missing',
          danger: true,
        },
      );
    }
    if (view === 'sessions' && selectedSession) {
      list.push(
        {
          key: 'a',
          label: 'Archive session',
          description: 'Hide from Claude Code, reversible',
          run: () => sessionAction('archive', selectedSession),
          disabled: selectedSession.archived,
          disabledReason: 'already archived',
        },
        {
          key: 'r',
          label: 'Restore session',
          description: 'Move back into the projects directory',
          run: () => sessionAction('restore', selectedSession),
          disabled: !selectedSession.archived,
          disabledReason: 'session is not archived',
        },
        {
          key: 'c',
          label: 'Check integrity',
          description: 'Validate every record in the session file',
          run: () => checkSession(selectedSession),
        },
        {
          key: 'd',
          label: 'Delete session',
          description: 'Permanently remove the session file',
          run: () => sessionAction('delete', selectedSession),
          danger: true,
        },
      );
    }
    list.push(
      {
        key: 'U',
        label: 'Unpack archive',
        description: 'Restore a .claudepack to a new location',
        run: startUnpack,
      },
      {
        key: 'B',
        label: 'Backup manager',
        description: 'Create, restore, or delete history backups',
        run: startBackups,
      },
      {
        key: 'V',
        label: 'Health check',
        description: 'Find broken references and orphaned data',
        run: () => {
          setBusy(true);
          DiagnosticsService.healthCheck()
            .then((report) => showOverlay('Health check', report.text))
            .finally(() => setBusy(false));
        },
      },
      {
        key: 'P',
        label: 'Prune orphans',
        description: 'Delete session folders with no project',
        run: startPrune,
      },
      {
        key: 'g',
        label: 'Run diagnostics',
        description: 'Environment summary and counts',
        run: runDiagnostics,
      },
      {
        key: 'R',
        label: 'Rescan',
        description: 'Rediscover projects and sessions',
        run: refresh,
      },
      {
        key: 'M',
        label: 'Refresh metadata',
        description: 'Clear the title cache and re-read sessions',
        run: rescanMetadata,
      },
    );
    return list;
  }, [
    view,
    scopeProject,
    highlightedItem,
    selectedSession,
    openProject,
    startMove,
    startRepair,
    startPack,
    startRemove,
    showInfo,
    sessionAction,
    checkSession,
    startUnpack,
    startBackups,
    startPrune,
    runDiagnostics,
    refresh,
    rescanMetadata,
    showOverlay,
  ]);

  // ---- Keyboard --------------------------------------------------------

  const inputActive = modals.length === 0 && !menuOpen && !busy;

  useInput(
    (input, key) => {
      // Search capture takes priority while typing.
      if (searchActive) {
        if (key.escape) {
          setQuery('');
          setSearchActive(false);
        } else if (key.return) {
          setSearchActive(false);
        } else if (key.backspace || key.delete) {
          setQuery((q) => q.slice(0, -1));
        } else if (input && !key.ctrl && !key.meta) {
          setQuery((q) => q + input);
          setProjectIndex(0);
          setSessionIndex(0);
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
        setMenuOpen(true);
        return;
      }
      if (input === '/') {
        setSearchActive(true);
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

      // Detail tab switching and scrolling.
      if (key.tab) {
        setDetailTab((t) => DETAIL_TABS[(DETAIL_TABS.indexOf(t) + 1) % DETAIL_TABS.length]);
        setDetailScroll(0);
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

      // Global service shortcuts, mirrored in the action menu.
      const shortcut = actions.find((a) => a.key === input && !a.disabled && a.key.length === 1);
      const navigationKeys = new Set(['k', 'j', 'l', 'h']);
      if (shortcut && !navigationKeys.has(input)) {
        shortcut.run();
        return;
      }

      if (view === 'projects') {
        if (key.upArrow || input === 'k') {
          setProjectIndex((i) => Math.max(0, i - 1));
        } else if (key.downArrow || input === 'j') {
          setProjectIndex((i) => Math.min(projectItems.length - 1, i + 1));
        } else if (key.return || key.rightArrow || input === 'l') {
          if (highlightedItem) openProject(highlightedItem);
        }
        return;
      }

      // Sessions view
      if (key.escape || key.leftArrow || input === 'h') {
        setView('projects');
        setQuery('');
        return;
      }
      if (key.upArrow || input === 'k') {
        setSessionIndex((i) => Math.max(0, i - 1));
      } else if (key.downArrow || input === 'j') {
        setSessionIndex((i) => Math.min(Math.max(0, visibleSessions.length - 1), i + 1));
      }
    },
    { isActive: inputActive },
  );

  // ---- Layout ----------------------------------------------------------

  const mainHeight = rows - 1;
  const leftWidth = Math.min(56, Math.max(30, Math.floor(columns * 0.36)));
  // Panel borders take 2 columns, the row's own padding takes 2 more.
  const rowWidth = Math.max(10, leftWidth - 4);
  const listHeight = mainHeight - 4;
  const detailHeight = mainHeight - 4;

  const listTitle =
    view === 'projects'
      ? `Projects (${(projects ?? []).length})`
      : `Sessions${activeProject ? `: ${shortenPath(activeProject.orphaned ? activeProject.encoded : activeProject.path, home)}` : ': all projects'}`;

  const detailTitle =
    view === 'sessions' && selectedSession
      ? DETAIL_TABS.map((t) => (t === detailTab ? `[${t}]` : ` ${t} `)).join('')
      : scopeProject
        ? `Project: ${shortenPath(scopeProject.orphaned ? scopeProject.encoded : scopeProject.path, home)}`
        : 'Overview';

  const bindings: Array<[string, string]> =
    view === 'projects'
      ? [
          ['↑↓', 'navigate'],
          ['enter', 'sessions'],
          ['x', 'actions'],
          ['/', 'search'],
          ['m', 'move'],
          ['F', 'repair'],
          ['V', 'health'],
          ['?', 'help'],
          ['q', 'quit'],
        ]
      : [
          ['↑↓', 'navigate'],
          ['tab', 'detail tab'],
          ['x', 'actions'],
          ['/', 'search'],
          ['a', 'archive'],
          ['d', 'delete'],
          ['t', showArchived ? 'live' : 'archived'],
          ['esc', 'back'],
          ['q', 'quit'],
        ];

  const topModal = modals[modals.length - 1] ?? null;

  if (topModal) {
    return (
      <Box flexDirection="column" width={columns} height={rows}>
        {topModal.kind === 'overlay' ? (
          <OverlayView modal={topModal} active={!busy} width={columns} height={mainHeight} onClose={pop} />
        ) : (
          <Box
            width={columns}
            height={mainHeight}
            alignItems="center"
            justifyContent="center"
            flexDirection="column"
          >
            {topModal.kind === 'confirm' ? (
              <ConfirmDialog modal={topModal} active={!busy} />
            ) : topModal.kind === 'input' ? (
              <InputDialog key={modals.length} modal={topModal} active={!busy} />
            ) : (
              <SelectDialog key={modals.length} modal={topModal} active={!busy} />
            )}
          </Box>
        )}
        <HelpBar bindings={bindings} status={busy ? 'Working…' : status} />
      </Box>
    );
  }

  if (menuOpen) {
    return (
      <Box flexDirection="column" width={columns} height={rows}>
        <Box
          width={columns}
          height={mainHeight}
          alignItems="center"
          justifyContent="center"
          flexDirection="column"
        >
          <ActionMenu
            title={view === 'projects' ? 'Project actions' : 'Session actions'}
            actions={actions}
            active
            onClose={() => setMenuOpen(false)}
          />
        </Box>
        <HelpBar bindings={bindings} status={busy ? 'Working…' : status} />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      <Box height={mainHeight}>
        <Panel title={listTitle} focused width={leftWidth} height={mainHeight}>
          <SearchBar
            query={query}
            active={searchActive}
            matches={view === 'projects' ? projectItems.length : visibleSessions.length}
            total={view === 'projects' ? allProjectItems.length : sessions.length}
          />
          {view === 'projects' ? (
            loadError && projects === null ? (
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
                items={projectItems}
                selectedIndex={projectIndex}
                height={listHeight}
                focused
                linesPerItem={2}
                emptyMessage="No projects match"
                renderItem={(item, selected) =>
                  item.kind === 'all' ? (
                    <AllSessionsRow
                      selected={selected}
                      count={(projects ?? []).reduce((sum, p) => sum + p.sessions, 0)}
                      width={rowWidth}
                    />
                  ) : (
                    <ProjectRow
                      project={item.project}
                      selected={selected}
                      home={home}
                      width={rowWidth}
                    />
                  )
                }
              />
            )
          ) : sessionsLoading ? (
            <Box paddingX={1}>
              <Text dimColor>Loading sessions…</Text>
            </Box>
          ) : (
            <ListView
              items={visibleSessions}
              selectedIndex={sessionIndex}
              height={listHeight}
              focused
              linesPerItem={2}
              emptyMessage={showArchived ? 'No archived sessions' : 'No sessions'}
              renderItem={(session, selected) => (
                <SessionRow
                  session={session}
                  metadata={metadata.get(session.file)}
                  selected={selected}
                  showProject={activeProject === null}
                  home={home}
                  width={rowWidth}
                />
              )}
            />
          )}
        </Panel>

        <Box flexDirection="column" flexGrow={1}>
          <Panel title={detailTitle} focused={false} height={mainHeight}>
            {view === 'sessions' && selectedSession ? (
              <SessionDetail
                session={selectedSession}
                metadata={metadata.get(selectedSession.file)}
                conversation={conversation}
                loading={conversationLoading}
                tab={detailTab}
                home={home}
                height={detailHeight}
                scroll={detailScroll}
                projectPath={
                  activeProject && !activeProject.orphaned
                    ? activeProject.path
                    : projectByEncoded.get(selectedSession.encoded)
                }
              />
            ) : (
              <ProjectDetail
                project={scopeProject}
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
    </Box>
  );
}
