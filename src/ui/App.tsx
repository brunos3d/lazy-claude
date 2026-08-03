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
import {
  archiveSession,
  deleteSession,
  listAllArchivedSessions,
  listAllSessions,
  listArchivedSessions,
  listSessions,
  readSessionDetail,
  restoreSession,
  validateSession,
  type SessionDetail,
  type SessionEntry,
} from '../services/SessionService.js';
import { formatBytes, formatKb, formatRelativeTime, shortenPath } from '../core/format.js';
import { DetailPanel } from './DetailPanel.js';
import { HelpBar } from './HelpBar.js';
import { ListView } from './ListView.js';
import { Panel } from './Panel.js';
import { useTerminalSize } from './useTerminalSize.js';
import {
  ConfirmDialog,
  InputDialog,
  OverlayView,
  SelectDialog,
  type Modal,
} from './modals.js';

type Focus = 'projects' | 'sessions';

type ProjectItem = { kind: 'all' } | { kind: 'project'; project: Project };

const HELP_TEXT = `Lazy Claude keybindings

Navigation
  ↑/k ↓/j        move selection
  tab ←/→ h/l    switch panel
  enter          open sessions of the highlighted project
  esc            back to projects panel

Sessions
  a              archive session (hides it from Claude Code, reversible)
  r              restore an archived session
  d / x          delete session permanently
  c              check session file integrity
  t              toggle live / archived view

Projects
  m              move project (migrates all session references)
  F              repair broken references after a manual move
  D              remove project and all session data
  p              pack project + sessions into a .claudepack archive
  i              project info

Global
  U              unpack a .claudepack archive
  B              backup manager (history.jsonl)
  V              health check
  P              prune orphaned session folders
  R              refresh
  ?              this help
  q              quit`;

function expandHome(input: string): string {
  if (input === '~') return os.homedir();
  if (input.startsWith('~/') || input.startsWith('~\\')) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

export function App() {
  const { exit } = useApp();
  const { columns, rows } = useTerminalSize();
  const home = os.homedir();

  const [projects, setProjects] = useState<Project[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [focus, setFocus] = useState<Focus>('projects');
  const [projectIndex, setProjectIndex] = useState(0);
  const [sessionIndex, setSessionIndex] = useState(0);
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [modals, setModals] = useState<Modal[]>([]);
  const [status, setStatus] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  const refresh = useCallback(() => setRefreshTick((t) => t + 1), []);
  const push = useCallback((modal: Modal) => setModals((s) => [...s, modal]), []);
  const pop = useCallback(() => setModals((s) => s.slice(0, -1)), []);
  const showOverlay = useCallback(
    (title: string, body: string) => setModals([{ kind: 'overlay', title, body }]),
    [],
  );

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

  const projectItems = useMemo<ProjectItem[]>(() => {
    const items: ProjectItem[] = [{ kind: 'all' }];
    for (const project of projects ?? []) {
      items.push({ kind: 'project', project });
    }
    return items;
  }, [projects]);

  const selectedItem = projectItems[Math.min(projectIndex, projectItems.length - 1)] ?? null;
  const selectedProject = selectedItem?.kind === 'project' ? selectedItem.project : null;

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
      .then((list) => {
        if (cancelled) return;
        setSessions(list);
        setSessionIndex((i) => Math.min(i, Math.max(0, list.length - 1)));
        setSessionsLoading(false);
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

  const selectedSession =
    focus === 'sessions' && sessions.length > 0
      ? sessions[Math.min(sessionIndex, sessions.length - 1)]
      : null;

  useEffect(() => {
    setDetail(null);
    if (!selectedSession) return;
    let cancelled = false;
    readSessionDetail(selectedSession)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch(() => {
        if (!cancelled) setDetail({ scannedRecords: 0, invalidRecords: 0 });
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSession?.file]);

  /** Run a service operation, then show its report and refresh. */
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
          MoveService.move({
            source: project.path,
            destination,
            parents: true,
            dryRun: true,
          })
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
                    return [
                      ...report.steps,
                      '',
                      `Resume with: cd ${report.destination} && claude --continue`,
                    ];
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
      const defaultArchive = path.join(os.homedir(), `${path.basename(project.path)}.claudepack`);
      push({
        kind: 'input',
        title: 'Pack project',
        label: `Archive path for ${project.path}`,
        initial: defaultArchive,
        onResult: (value) => {
          pop();
          if (!value) return;
          runOp('Pack project', async () => {
            const report = await PackService.pack({
              source: project.path,
              archive: expandHome(value),
            });
            return [
              ...report.steps,
              '',
              `Unpack elsewhere with: lazy-claude unpack ${report.archive} <destination>`,
            ];
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
                  const report = await PackService.unpack({
                    archive,
                    destination,
                    parents: true,
                  });
                  return [
                    ...report.steps,
                    '',
                    `Resume with: cd ${report.destination} && claude --continue`,
                  ];
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
    if (selectedProject && !selectedProject.exists && !selectedProject.orphaned) {
      chooseRepairTarget(selectedProject.path);
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
  }, [projects, selectedProject, chooseRepairTarget, pop, push, showOverlay]);

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
              (b) =>
                `${b.name}  ${formatRelativeTime(b.createdAt)}  ${formatBytes(b.sizeBytes)}`,
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
          const lines = [
            `Project: ${info.path}`,
            `Encoded folder: ${info.encoded}`,
            `Project directory: ${info.projectExists ? 'exists' : 'missing'}`,
            ...(info.projectExists ? [`Project size: ${formatKb(info.projectSizeKb)}`] : []),
            `.claude settings: ${info.hasClaudeSettings ? 'found' : 'not found'}`,
            `Sessions: ${info.sessionCount} file(s), ${formatKb(info.sessionSizeKb)}` +
              (info.archivedCount > 0 ? ` (+${info.archivedCount} archived)` : ''),
            ...(info.newestSession
              ? [`Newest session: ${info.newestSession.toLocaleString()}`]
              : []),
            ...(info.oldestSession
              ? [`Oldest session: ${info.oldestSession.toLocaleString()}`]
              : []),
            `History entries: ${info.historyEntries.exact} (${info.historyEntries.nested} nested)`,
          ];
          showOverlay(`Info: ${shortenPath(info.path, home)}`, lines.join('\n'));
        })
        .catch((error: Error) => {
          setBusy(false);
          showOverlay('Info failed', error.message);
        });
    },
    [home, showOverlay],
  );

  const confirmSessionAction = useCallback(
    (kind: 'archive' | 'restore' | 'delete', session: SessionEntry) => {
      const messages: Record<typeof kind, { title: string; message: string; danger: boolean }> = {
        archive: {
          title: 'Archive session',
          message: `Archive session ${session.id}? It moves to the Lazy Claude archive and disappears from Claude Code until restored.`,
          danger: false,
        },
        restore: {
          title: 'Restore session',
          message: `Restore session ${session.id} back into the Claude projects directory?`,
          danger: false,
        },
        delete: {
          title: 'Delete session',
          message: `Permanently delete session ${session.id}? This removes the session file and cannot be undone.`,
          danger: true,
        },
      };
      const { title, message, danger } = messages[kind];
      push({
        kind: 'confirm',
        title,
        message,
        danger,
        onResult: (ok) => {
          pop();
          if (!ok) return;
          setBusy(true);
          const action =
            kind === 'archive'
              ? archiveSession(session)
              : kind === 'restore'
                ? restoreSession(session)
                : deleteSession(session);
          action
            .then(() => setStatus(`${title.split(' ')[0]}d ${session.id.slice(0, 8)}`))
            .catch((error: Error) => setStatus(`Error: ${error.message}`))
            .finally(() => {
              setBusy(false);
              refresh();
            });
        },
      });
    },
    [pop, push, refresh],
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
        push({
          kind: 'confirm',
          title: 'Prune orphaned session folders',
          danger: true,
          message: preview.text,
          onResult: (ok) => {
            pop();
            if (!ok) return;
            runOp('Prune', async () => {
              const report = await DiagnosticsService.pruneOrphans(false);
              return report.steps;
            });
          },
        });
      })
      .catch((error: Error) => {
        setBusy(false);
        showOverlay('Prune failed', error.message);
      });
  }, [pop, push, runOp, showOverlay]);

  // ---- Main keyboard handling -----------------------------------------

  useInput(
    (input, key) => {
      if (input === 'q') {
        exit();
        return;
      }
      if (input === '?') {
        showOverlay('Help', HELP_TEXT);
        return;
      }
      if (input === 'R') {
        setStatus('Refreshing…');
        refresh();
        return;
      }
      if (input === 'V') {
        setBusy(true);
        DiagnosticsService.healthCheck()
          .then((report) => showOverlay('Health check', report.text))
          .finally(() => setBusy(false));
        return;
      }
      if (input === 'P') {
        startPrune();
        return;
      }
      if (input === 'B') {
        startBackups();
        return;
      }
      if (input === 'U') {
        startUnpack();
        return;
      }
      if (input === 'F') {
        startRepair();
        return;
      }
      if (input === 't') {
        setShowArchived((v) => !v);
        setSessionIndex(0);
        return;
      }
      if (input === 'i' && selectedProject) {
        showInfo(selectedProject);
        return;
      }

      if (key.tab || key.rightArrow || input === 'l') {
        setFocus('sessions');
        return;
      }
      if (key.leftArrow || input === 'h') {
        setFocus('projects');
        return;
      }

      if (focus === 'projects') {
        if (key.upArrow || input === 'k') {
          setProjectIndex((i) => Math.max(0, i - 1));
          setSessionIndex(0);
        } else if (key.downArrow || input === 'j') {
          setProjectIndex((i) => Math.min(projectItems.length - 1, i + 1));
          setSessionIndex(0);
        } else if (key.return) {
          setFocus('sessions');
        } else if (selectedProject) {
          if (input === 'm' && selectedProject.exists) startMove(selectedProject);
          else if (input === 'D' && selectedProject.exists) startRemove(selectedProject);
          else if (input === 'p' && selectedProject.exists) startPack(selectedProject);
        }
        return;
      }

      // Sessions panel
      if (key.escape) {
        setFocus('projects');
        return;
      }
      if (key.upArrow || input === 'k') {
        setSessionIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow || input === 'j') {
        setSessionIndex((i) => Math.min(Math.max(0, sessions.length - 1), i + 1));
        return;
      }

      const current = sessions[Math.min(sessionIndex, sessions.length - 1)];
      if (!current) return;

      if (input === 'a' && !current.archived) confirmSessionAction('archive', current);
      else if (input === 'r' && current.archived) confirmSessionAction('restore', current);
      else if (input === 'd' || input === 'x') confirmSessionAction('delete', current);
      else if (input === 'c') {
        setBusy(true);
        validateSession(current)
          .then((integrity) =>
            setStatus(
              `${current.id.slice(0, 8)}: ${integrity.validRecords}/${integrity.totalLines} valid` +
                (integrity.ok ? '' : ` (${integrity.invalidLines} invalid!)`),
            ),
          )
          .catch((error: Error) => setStatus(`Error: ${error.message}`))
          .finally(() => setBusy(false));
      }
    },
    { isActive: modals.length === 0 && !busy },
  );

  // ---- Layout ---------------------------------------------------------

  const mainHeight = rows - 1;
  const projectsWidth = Math.min(46, Math.max(28, Math.floor(columns * 0.35)));
  const detailHeight = Math.min(13, Math.max(8, Math.floor(mainHeight * 0.35)));
  const sessionsHeight = mainHeight - detailHeight;
  const projectsViewport = mainHeight - 3;
  const sessionsViewport = sessionsHeight - 3;

  const bindings: Array<[string, string]> =
    focus === 'sessions'
      ? [
          ['↑↓', 'navigate'],
          ['a', 'archive'],
          showArchived ? ['r', 'restore'] : ['d', 'delete'],
          ['c', 'check'],
          ['t', showArchived ? 'live view' : 'archived'],
          ['esc', 'projects'],
          ['?', 'help'],
          ['q', 'quit'],
        ]
      : [
          ['↑↓', 'navigate'],
          ['m', 'move'],
          ['F', 'repair'],
          ['D', 'remove'],
          ['p', 'pack'],
          ['B', 'backups'],
          ['V', 'health'],
          ['?', 'help'],
          ['q', 'quit'],
        ];

  const sessionsTitle = `${showArchived ? 'Archived sessions' : 'Sessions'}${
    selectedItem?.kind === 'project'
      ? `: ${shortenPath(selectedProject!.orphaned ? selectedProject!.encoded : selectedProject!.path, home)}`
      : ': all projects'
  }`;

  const topModal = modals[modals.length - 1] ?? null;

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      {topModal ? (
        topModal.kind === 'overlay' ? (
          <OverlayView
            modal={topModal}
            active={!busy}
            width={columns}
            height={mainHeight}
            onClose={pop}
          />
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
        )
      ) : (
        <Box height={mainHeight}>
          <Panel title="Projects" focused={focus === 'projects'} width={projectsWidth}>
            {loadError && projects === null ? (
              <Box paddingX={1} flexDirection="column">
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
                height={projectsViewport}
                focused={focus === 'projects'}
                width={projectsWidth - 2}
                emptyMessage="No projects found"
                renderItem={(item) => {
                  if (item.kind === 'all') {
                    return <Text bold>▣ All sessions</Text>;
                  }
                  const p = item.project;
                  const dot = p.orphaned ? '◌' : p.exists ? '●' : '○';
                  const dotColor = p.orphaned ? 'yellow' : p.exists ? 'green' : 'red';
                  const label = p.orphaned ? p.encoded : shortenPath(p.path, home);
                  return (
                    <>
                      <Text color={dotColor}>{dot} </Text>
                      <Text>{label}</Text>
                      <Text dimColor> ({p.sessions})</Text>
                    </>
                  );
                }}
              />
            )}
          </Panel>
          <Box flexDirection="column" flexGrow={1}>
            <Panel title={sessionsTitle} focused={focus === 'sessions'} height={sessionsHeight}>
              {sessionsLoading ? (
                <Box paddingX={1}>
                  <Text dimColor>Loading sessions…</Text>
                </Box>
              ) : (
                <ListView
                  items={sessions}
                  selectedIndex={sessionIndex}
                  height={sessionsViewport}
                  focused={focus === 'sessions'}
                  width={columns - projectsWidth - 2}
                  emptyMessage={showArchived ? 'No archived sessions' : 'No sessions'}
                  renderItem={(s) => (
                    <>
                      <Text color="cyan">{s.id.slice(0, 8)}</Text>
                      <Text dimColor> {formatRelativeTime(s.modifiedAt).padStart(9)}</Text>
                      <Text dimColor> {formatBytes(s.sizeBytes).padStart(9)}</Text>
                      {selectedItem?.kind === 'all' ? <Text> {s.encoded}</Text> : null}
                    </>
                  )}
                />
              )}
            </Panel>
            <DetailPanel
              height={detailHeight}
              session={selectedSession}
              detail={detail}
              project={selectedProject}
              showingSession={focus === 'sessions' && selectedSession !== null}
              allSummary={
                selectedItem?.kind === 'all' && projects
                  ? {
                      projects: projects.length,
                      sessions: projects.reduce((sum, p) => sum + p.sessions, 0),
                      broken: projects.filter((p) => !p.exists && !p.orphaned).length,
                      orphans: projects.filter((p) => p.orphaned).length,
                    }
                  : null
              }
            />
          </Box>
        </Box>
      )}
      <HelpBar bindings={bindings} status={busy ? 'Working…' : status} />
    </Box>
  );
}
