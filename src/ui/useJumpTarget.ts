import { useCallback, useEffect, useState } from 'react';
import type { JumpTarget } from '../services/search/types.js';
import type { SessionEntry } from '../services/SessionService.js';
import type { DetailTab } from './SessionDetail.js';
import type { Focus, ProjectItem } from './types.js';

/**
 * Which list of sessions is currently loaded. Archived and live sessions
 * of one project are two different lists, so the toggle is part of the key
 * or a jump into the archive would resolve against the live list.
 */
export function pendingKey(encoded: string, archived: boolean): string {
  return `${encoded}|${archived}`;
}

export interface JumpPlan {
  projectIndex: number;
  /** null leaves the archived toggle alone. */
  showArchived: boolean | null;
  focus: Focus;
  detailTab: DetailTab | null;
  /** Set when a session still has to be selected once its list loads. */
  pending: { key: string; file: string } | null;
}

/**
 * Work out every state change a jump implies, with no React involved.
 *
 * Kept pure so the interesting part, which list ends up selected and
 * whether a second asynchronous step is needed, is testable without
 * mounting the app.
 */
export function planJump(target: JumpTarget, items: ProjectItem[]): JumpPlan | null {
  const projectIndex = items.findIndex(
    (item) => item.kind === 'project' && item.project.encoded === target.encoded,
  );
  if (projectIndex < 0) return null;

  if (target.kind === 'project') {
    return {
      projectIndex,
      showArchived: null,
      focus: 'projects',
      detailTab: null,
      pending: null,
    };
  }

  return {
    projectIndex,
    showArchived: target.archived,
    focus: target.kind === 'message' ? 'details' : 'sessions',
    detailTab: target.kind === 'message' ? 'conversation' : null,
    pending: { key: pendingKey(target.encoded, target.archived), file: target.file },
  };
}

/** The App state a jump has to drive. Every member is a stable setter. */
export interface JumpActions {
  setProjectIndex: (index: number) => void;
  setSessionIndex: (index: number) => void;
  setFocus: (focus: Focus) => void;
  setShowArchived: (value: boolean) => void;
  setProjectQuery: (query: string) => void;
  setSessionQuery: (query: string) => void;
  setSearching: (value: boolean) => void;
  setDetailTab: (tab: DetailTab) => void;
  setDetailScroll: (value: number) => void;
  setStatus: (status: string) => void;
}

/**
 * Turn a search result into a selection.
 *
 * The hard part is that selecting a project starts an asynchronous session
 * load, so the session a user picked does not exist in the list on the
 * render that selects its project. The jump is therefore two steps: apply
 * everything that is immediate, then hold the session file in `pending`
 * until the matching list has actually arrived.
 */
export function useJumpTarget(options: {
  /** Unfiltered project rows. Queries are cleared as part of the jump. */
  items: ProjectItem[];
  sessions: SessionEntry[];
  sessionsLoading: boolean;
  /** pendingKey of the session list currently loaded, or null. */
  loadedKey: string | null;
  actions: JumpActions;
}): (target: JumpTarget) => void {
  const { items, sessions, sessionsLoading, loadedKey, actions } = options;
  const [pending, setPending] = useState<{ key: string; file: string } | null>(null);

  const jumpTo = useCallback(
    (target: JumpTarget) => {
      const plan = planJump(target, items);
      if (!plan) {
        actions.setStatus('That result is no longer available.');
        return;
      }

      // A live filter on either panel could hide the very row being jumped
      // to, so both queries go before anything is selected.
      actions.setSearching(false);
      actions.setProjectQuery('');
      actions.setSessionQuery('');
      if (plan.showArchived !== null) actions.setShowArchived(plan.showArchived);
      actions.setProjectIndex(plan.projectIndex);
      if (plan.detailTab) {
        actions.setDetailTab(plan.detailTab);
        actions.setDetailScroll(0);
      }
      actions.setFocus(plan.focus);
      setPending(plan.pending);
      if (!plan.pending) actions.setSessionIndex(0);
    },
    [items, actions],
  );

  useEffect(() => {
    if (!pending || sessionsLoading) return;
    // Wait for the list that actually belongs to the target, otherwise the
    // previous project's sessions would resolve the jump against the wrong
    // set and land on an arbitrary row.
    if (loadedKey !== pending.key) return;

    const index = sessions.findIndex((session) => session.file === pending.file);
    if (index >= 0) actions.setSessionIndex(index);
    else actions.setStatus('That session is no longer available.');
    setPending(null);
  }, [pending, sessions, sessionsLoading, loadedKey, actions]);

  return jumpTo;
}
