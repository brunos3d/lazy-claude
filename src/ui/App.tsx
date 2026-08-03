import React, { useCallback, useEffect, useMemo, useState } from 'react';
import os from 'node:os';
import { Box, Text, useApp, useInput } from 'ink';
import { discoverProjects, type Project } from '../lib/projects.js';
import { healthCheck, projectInfoText, pruneOrphans } from '../lib/maintenance.js';
import {
  archiveSession,
  deleteSession,
  listAllArchivedSessions,
  listAllSessions,
  listArchivedSessions,
  listSessions,
  readSessionDetail,
  restoreSession,
  type SessionDetail,
  type SessionEntry,
} from '../lib/sessions.js';
import { formatBytes, formatRelativeTime, shortenPath } from '../lib/format.js';
import { ConfirmDialog } from './ConfirmDialog.js';
import { DetailPanel } from './DetailPanel.js';
import { HelpBar } from './HelpBar.js';
import { ListView } from './ListView.js';
import { OutputOverlay } from './OutputOverlay.js';
import { Panel } from './Panel.js';
import { useTerminalSize } from './useTerminalSize.js';

type Focus = 'projects' | 'sessions';

type Dialog =
  | { kind: 'archive' | 'delete' | 'restore'; session: SessionEntry }
  | { kind: 'prune' };

interface Overlay {
  title: string;
  body: string;
}

type ProjectItem = { kind: 'all' } | { kind: 'project'; project: Project };

const HELP_TEXT = `Lazy Claude keybindings

Navigation
  ↑/k ↓/j        move selection
  tab ←/→ h/l    switch panel
  enter          open sessions of the highlighted project
  esc            back to projects panel

Sessions
  a              archive session (moves it out of the projects directory)
  r              restore an archived session
  d / x          delete session permanently
  t              toggle live / archived view

Global
  R              refresh everything
  i              project info
  V              health check
  P              prune orphaned session folders
  ?              this help
  q              quit

Archived sessions live in <claude-dir>/lazy-claude/archive and are
invisible to Claude Code until restored.`;

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
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [overlayScroll, setOverlayScroll] = useState(0);
  const [status, setStatus] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  const refresh = useCallback(() => setRefreshTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    discoverProjects()
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

  // Load sessions whenever the highlighted project or view mode changes.
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

  // Lazily read metadata for the selected session.
  useEffect(() => {
    setDetail(null);
    if (!selectedSession) return;
    let cancelled = false;
    readSessionDetail(selectedSession)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch(() => {
        if (!cancelled) setDetail({ scannedRecords: 0 });
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSession?.file]);

  const openOverlay = useCallback((title: string, body: string) => {
    setOverlay({ title, body });
    setOverlayScroll(0);
  }, []);

  const runDialogAction = useCallback(
    async (active: Dialog) => {
      setBusy(true);
      try {
        if (active.kind === 'prune') {
          const report = await pruneOrphans();
          openOverlay('Prune', report);
        } else if (active.kind === 'archive') {
          await archiveSession(active.session);
          setStatus(`Archived ${active.session.id.slice(0, 8)}`);
        } else if (active.kind === 'restore') {
          await restoreSession(active.session);
          setStatus(`Restored ${active.session.id.slice(0, 8)}`);
        } else {
          await deleteSession(active.session);
          setStatus(`Deleted ${active.session.id.slice(0, 8)}`);
        }
        refresh();
      } catch (error) {
        setStatus(`Error: ${(error as Error).message}`);
      } finally {
        setBusy(false);
        setDialog(null);
      }
    },
    [openOverlay, refresh],
  );

  useInput((input, key) => {
    if (busy) return;

    if (overlay) {
      if (key.escape || input === 'q') setOverlay(null);
      if (key.upArrow || input === 'k') setOverlayScroll((s) => Math.max(0, s - 1));
      if (key.downArrow || input === 'j') setOverlayScroll((s) => s + 1);
      return;
    }

    if (dialog) {
      if (input === 'y' || input === 'Y') void runDialogAction(dialog);
      else if (input === 'n' || input === 'N' || key.escape) setDialog(null);
      return;
    }

    if (input === 'q') {
      exit();
      return;
    }
    if (input === '?') {
      openOverlay('Help', HELP_TEXT);
      return;
    }
    if (input === 'R') {
      setStatus('Refreshing…');
      refresh();
      return;
    }
    if (input === 'V') {
      setStatus('Running health check…');
      void healthCheck().then((report) => {
        setStatus(undefined);
        openOverlay('Health check', report.text);
      });
      return;
    }
    if (input === 'P') {
      setDialog({ kind: 'prune' });
      return;
    }
    if (input === 'i' && selectedProject) {
      void projectInfoText(selectedProject).then((text) => {
        openOverlay(`Info: ${shortenPath(selectedProject.path, home)}`, text);
      });
      return;
    }
    if (input === 't') {
      setShowArchived((v) => !v);
      setSessionIndex(0);
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

    if (input === 'a' && !current.archived) {
      setDialog({ kind: 'archive', session: current });
    } else if (input === 'r' && current.archived) {
      setDialog({ kind: 'restore', session: current });
    } else if (input === 'd' || input === 'x') {
      setDialog({ kind: 'delete', session: current });
    }
  });

  // Layout
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
          ['t', showArchived ? 'live view' : 'archived'],
          ['esc', 'projects'],
          ['?', 'help'],
          ['q', 'quit'],
        ]
      : [
          ['↑↓', 'navigate'],
          ['enter', 'sessions'],
          ['i', 'info'],
          ['V', 'health'],
          ['P', 'prune'],
          ['R', 'refresh'],
          ['?', 'help'],
          ['q', 'quit'],
        ];

  const sessionsTitle = `${showArchived ? 'Archived sessions' : 'Sessions'}${
    selectedItem?.kind === 'project'
      ? `: ${shortenPath(selectedProject!.orphaned ? selectedProject!.encoded : selectedProject!.path, home)}`
      : ': all projects'
  }`;

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      {overlay ? (
        <OutputOverlay
          title={overlay.title}
          body={overlay.body}
          width={columns}
          height={mainHeight}
          scroll={overlayScroll}
        />
      ) : dialog ? (
        <Box
          width={columns}
          height={mainHeight}
          alignItems="center"
          justifyContent="center"
          flexDirection="column"
        >
          <ConfirmDialog
            title={
              dialog.kind === 'prune'
                ? 'Prune orphaned session folders'
                : `${dialog.kind[0].toUpperCase()}${dialog.kind.slice(1)} session`
            }
            message={
              dialog.kind === 'prune'
                ? 'Permanently delete every orphaned session folder in the Claude projects directory?'
                : dialog.kind === 'delete'
                  ? `Permanently delete session ${dialog.session.id}? This removes the session file and cannot be undone.`
                  : dialog.kind === 'archive'
                    ? `Archive session ${dialog.session.id}? It moves to the Lazy Claude archive and disappears from Claude Code until restored.`
                    : `Restore session ${dialog.session.id} back into the Claude projects directory?`
            }
            danger={dialog.kind === 'delete' || dialog.kind === 'prune'}
          />
        </Box>
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
