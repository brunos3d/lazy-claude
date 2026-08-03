import type { WorkspaceView } from '../ViewService.js';

/**
 * Vocabulary for workspace actions.
 *
 * These are the global half of the two command surfaces. An action here
 * either operates on the whole workspace or changes how the workspace is
 * displayed, and none of them read the current selection: anything that
 * needs a highlighted project or session belongs in `ui/actions/registry.ts`
 * behind `x` instead. That rule is the only thing keeping both surfaces
 * from filling up with the same entries.
 *
 * Nothing here imports Ink or React. The palette is one consumer.
 */

export type ActionCategory = 'sort' | 'filter' | 'workspace' | 'insight';

/** Section headers inside the palette's Actions tab. */
export const CATEGORY_TITLES: Record<ActionCategory, string> = {
  sort: 'Sorting',
  filter: 'Filters',
  workspace: 'Workspace',
  insight: 'Statistics',
};

/** Presentation order, decided here rather than by registration order. */
export const CATEGORY_ORDER: ActionCategory[] = ['sort', 'filter', 'workspace', 'insight'];

export interface WorkspaceAction {
  /** Stable id. The palette hands this back and App runs the match. */
  id: string;
  title: string;
  subtitle?: string;
  /** Extra words that should find this action. Never displayed. */
  keywords?: string[];
  category: ActionCategory;
  /** Set when the action describes state that is currently on. */
  active?: boolean;
  danger?: boolean;
  run: () => void;
}

/** What a provider returns. The registry stamps the category on. */
export type ActionSpec = Omit<WorkspaceAction, 'category'>;

/**
 * Global operations, all of which already exist in App. The palette exposes
 * them; it does not reimplement them.
 */
export interface WorkspaceHandlers {
  rescan: () => void;
  refreshMetadata: () => void;
  repairReferences: () => void;
  healthCheck: () => void;
  diagnostics: () => void;
  backupManager: () => void;
  unpackArchive: () => void;
  pruneOrphans: () => void;
  statistics: () => void;
  toggleArchived: () => void;
}

/**
 * The single extension point for action providers, mirroring SearchContext.
 * New shared inputs become fields here and change no provider signature.
 *
 * `showArchived` stays out of WorkspaceView because the session list load
 * and the jump planner both key off it directly; folding it in would mean
 * rewriting those for no gain.
 */
export interface ActionContext {
  view: WorkspaceView;
  showArchived: boolean;
  setView: (next: WorkspaceView) => void;
  handlers: WorkspaceHandlers;
}

/**
 * A provider owns one category and is stateless. It never reads another
 * provider's output, which is what lets the registry concatenate them in
 * any order without their behaviour changing.
 */
export interface ActionProvider {
  id: string;
  category: ActionCategory;
  list(context: ActionContext): ActionSpec[];
}
