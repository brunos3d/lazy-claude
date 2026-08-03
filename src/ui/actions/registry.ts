import type { Project } from "../../services/DiscoveryService.js";
import type { SessionEntry } from "../../services/SessionService.js";

/**
 * The action registry.
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
  archiveSession: () => void;
  restoreSession: () => void;
  deleteSession: () => void;
  checkIntegrity: () => void;
  moveProject: () => void;
  repairReferences: () => void;
  packProject: () => void;
  projectInfo: () => void;
  removeProject: () => void;
  unpackArchive: () => void;
  backupManager: () => void;
  healthCheck: () => void;
  pruneOrphans: () => void;
  diagnostics: () => void;
  rescan: () => void;
  refreshMetadata: () => void;
}

/** Build the categories that apply to the current selection. */
export function buildActionCategories(
  context: ActionContext,
): ActionCategory[] {
  const { project, session, handlers } = context;
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
        label: "Resume session (dangerous)",
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

  const maintenance: ActionDefinition[] = [];
  if (session) {
    maintenance.push({
      key: "c",
      label: "Check integrity",
      description: "Validate every record in the session file",
      run: handlers.checkIntegrity,
    });
  }
  maintenance.push(
    {
      key: "B",
      label: "Backup manager",
      description: "Create, restore, or delete history backups",
      run: handlers.backupManager,
    },
    {
      key: "U",
      label: "Unpack archive",
      description: "Restore a .claudepack to a new location",
      run: handlers.unpackArchive,
    },
    {
      key: "V",
      label: "Health check",
      description: "Find broken references and orphaned data",
      run: handlers.healthCheck,
    },
    {
      key: "g",
      label: "Run diagnostics",
      description: "Environment summary and counts",
      run: handlers.diagnostics,
    },
    {
      key: "R",
      label: "Rescan",
      description: "Rediscover projects and sessions",
      run: handlers.rescan,
    },
    {
      key: "M",
      label: "Refresh metadata",
      description: "Clear the title cache and re-read sessions",
      run: handlers.refreshMetadata,
    },
  );
  categories.push({
    id: "maintenance",
    title: "Maintenance",
    accent: "blue",
    actions: maintenance,
  });

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
  dangerous.push({
    key: "P",
    label: "Prune orphans",
    description: "Delete session folders with no project",
    run: handlers.pruneOrphans,
    danger: true,
  });
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
