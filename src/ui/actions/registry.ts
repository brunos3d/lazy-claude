import type { Project } from "../../services/DiscoveryService.js";
import type { SessionEntry } from "../../services/SessionService.js";

/**
 * The contextual action registry, behind `x`.
 *
 * Everything here acts on the highlighted project or session: remove the
 * selection and the entry has nothing to run against. Operations that would
 * behave identically with nothing selected are workspace actions and live
 * in `services/actions/` behind the command palette instead. That rule is
 * mechanical on purpose, because without it both surfaces drift into
 * listing everything the program can do.
 *
 * The menu is generated from the current selection rather than hardcoded,
 * so a new operation is one entry here and appears in the right context
 * with the right grouping. Categories render in array order and Dangerous
 * is always last, which is what keeps destructive items away from the
 * routine ones.
 */

export interface ActionDefinition {
  /** Single-key shortcut, also usable directly inside the menu. */
  key: string;
  label: string;
  description: string;
  run: () => void;
  /** Disabled entries stay listed so the menu doubles as documentation. */
  disabled?: boolean;
  disabledReason?: string;
  danger?: boolean;
}

export interface ActionCategory {
  id: string;
  title: string;
  /** Colour for the title and the guide rail. */
  accent: string;
  danger?: boolean;
  actions: ActionDefinition[];
}

/** Everything the registry needs to decide what applies right now. */
export interface ActionContext {
  focus: "projects" | "sessions" | "details";
  project: Project | null;
  session: SessionEntry | null;
  handlers: ActionHandlers;
}

export interface ActionHandlers {
  resume: () => void;
  resumeDangerous: () => void;
  newSession: () => void;
  newSessionDangerous: () => void;
  archiveSession: () => void;
  restoreSession: () => void;
  deleteSession: () => void;
  checkIntegrity: () => void;
  moveProject: () => void;
  repairReferences: () => void;
  packProject: () => void;
  projectInfo: () => void;
  removeProject: () => void;
}

/** Build the categories that apply to the current selection. */
export function buildActionCategories(
  context: ActionContext,
): ActionCategory[] {
  const { project, handlers } = context;
  // The sessions panel always highlights a row, but from the projects panel
  // the user has not chosen it. Treating it as unselected keeps the menu
  // about the project and stops a session action from acting on a row the
  // user may never have looked at.
  const session = context.focus === "projects" ? null : context.session;
  const categories: ActionCategory[] = [];

  const sessionActions: ActionDefinition[] = [];
  if (session) {
    sessionActions.push(
      {
        key: "e",
        label: "Resume session",
        description: "Open this conversation in Claude Code",
        run: handlers.resume,
      },
      {
        key: "E",
        label: "Resume session (yolo)",
        description: "Resume with --dangerously-skip-permissions",
        danger: true,
        run: handlers.resumeDangerous,
      },
      {
        key: "a",
        label: "Archive session",
        description: "Hide from Claude Code, reversible",
        run: handlers.archiveSession,
        disabled: session.archived,
        disabledReason: "already archived",
      },
      {
        key: "r",
        label: "Restore session",
        description: "Move back into the projects directory",
        run: handlers.restoreSession,
        disabled: !session.archived,
        disabledReason: "session is not archived",
      },
      {
        key: "c",
        label: "Check integrity",
        description: "Validate every record in the session file",
        run: handlers.checkIntegrity,
      },
    );
  }
  if (sessionActions.length > 0) {
    categories.push({
      id: "session",
      title: "Session",
      accent: "cyan",
      actions: sessionActions,
    });
  }

  const projectActions: ActionDefinition[] = [];
  if (project) {
    const missing = !project.exists;
    projectActions.push(
      {
        key: "n",
        label: "New session",
        description: "Start a fresh Claude Code session here",
        run: handlers.newSession,
        disabled: missing,
        disabledReason: "project directory is missing",
      },
      {
        key: "N",
        label: "New session (yolo)",
        description: "Start with --dangerously-skip-permissions",
        danger: true,
        run: handlers.newSessionDangerous,
        disabled: missing,
        disabledReason: "project directory is missing",
      },
      {
        key: "m",
        label: "Move project",
        description: "Relocate and migrate every session reference",
        run: handlers.moveProject,
        disabled: missing,
        disabledReason: "project directory is missing",
      },
      {
        key: "F",
        label: "Repair references",
        description: "Relink sessions after a manual move",
        run: handlers.repairReferences,
      },
      {
        key: "p",
        label: "Pack project",
        description: "Archive project and sessions into .claudepack",
        run: handlers.packProject,
        disabled: missing,
        disabledReason: "project directory is missing",
      },
      {
        key: "i",
        label: "Project information",
        description: "Sizes, session counts, history entries",
        run: handlers.projectInfo,
      },
    );
  }
  if (projectActions.length > 0) {
    categories.push({
      id: "project",
      title: "Project",
      accent: "blue",
      actions: projectActions,
    });
  }

  // Dangerous is always last and visually separated.
  const dangerous: ActionDefinition[] = [];
  if (session) {
    dangerous.push({
      key: "d",
      label: "Delete session",
      description: "Permanently remove the session file",
      run: handlers.deleteSession,
      danger: true,
    });
  }
  if (project) {
    dangerous.push({
      key: "D",
      label: "Delete project",
      description: "Delete the project and all its session data",
      run: handlers.removeProject,
      disabled: !project.exists,
      disabledReason: "project directory is missing",
      danger: true,
    });
  }
  categories.push({
    id: "dangerous",
    title: "Dangerous",
    accent: "red",
    danger: true,
    actions: dangerous,
  });

  return categories;
}

/** Flatten for keyboard navigation: only actions are selectable. */
export function flattenActions(
  categories: ActionCategory[],
): ActionDefinition[] {
  return categories.flatMap((category) => category.actions);
}

/** Find a directly-typed shortcut across every category. */
export function findShortcut(
  categories: ActionCategory[],
  key: string,
): ActionDefinition | undefined {
  return flattenActions(categories).find(
    (action) => action.key === key && !action.disabled,
  );
}
