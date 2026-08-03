import type { Project } from '../DiscoveryService.js';
import type { SessionEntry } from '../SessionService.js';
import type { SessionMetadata } from '../SessionMetadataService.js';

/**
 * Vocabulary shared by the search engine, its providers, and the command
 * palette. Nothing here imports Ink or React: the palette is one consumer
 * of this layer, not its owner.
 */

export type ResultKind = 'project' | 'session' | 'message';

/**
 * Where selecting a result lands the interface.
 *
 * `encoded` is the join key throughout, because it is the only stable
 * identifier shared by Project, SessionEntry, and the archive tree. It is
 * never decoded back into a path.
 */
export type JumpTarget =
  | { kind: 'project'; encoded: string }
  | { kind: 'session'; encoded: string; file: string; archived: boolean }
  | { kind: 'message'; encoded: string; file: string; archived: boolean; anchor?: number };

/**
 * One row of the palette.
 *
 * This describes how a result is displayed and where it navigates, and
 * deliberately nothing else. A provider that needs extra data puts it in
 * `payload`, which the engine and the palette treat as opaque. Growing
 * this type with per-provider optional fields is what would stop it
 * working for every kind of result at once.
 */
export interface SearchHit {
  /** Stable identity, used as the React key. */
  id: string;
  kind: ResultKind;
  /** Primary line. */
  title: string;
  /** Match positions in `title`, for highlighting. */
  highlights?: number[];
  /** Second line: project path, or the owning project of a session. */
  subtitle?: string;
  /** Muted trailing text: relative time, session count, archived tag. */
  meta?: string;
  score: number;
  target: JumpTarget;
  /** Provider-owned extra data. Opaque to the engine and the palette. */
  payload?: unknown;
}

/**
 * All of one provider's results.
 *
 * Nothing is capped. The palette gives each group its own scrollable tab,
 * so `hits.length` is both the count shown on the tab and the number the
 * user can actually reach. An earlier design capped each group and showed
 * a "+N more" line, which made the hidden results unreachable: navigation
 * ran past the cap into the next group instead of into the remainder.
 */
export interface SearchGroup {
  kind: ResultKind;
  /** Tab label, for example "Projects". */
  title: string;
  hits: SearchHit[];
}

/** One in-memory snapshot of the workspace. Queries never touch disk. */
export interface WorkspaceIndex {
  projects: Project[];
  /** Live and archived, in one list. */
  sessions: SessionEntry[];
  metadata: Map<string, SessionMetadata>;
  /** encoded -> display label, for session subtitles. */
  projectLabels: Map<string, string>;
  home: string;
  status: 'empty' | 'building' | 'ready';
  /** Metadata progress while building. */
  done: number;
  total: number;
}

/**
 * The single extension point for providers. New shared inputs (a clock, a
 * deadline, a locale) become fields here and change no provider signature.
 */
export interface SearchContext {
  index: WorkspaceIndex;
  signal: AbortSignal;
}

/**
 * A provider describes what it provides, not where it appears. Group
 * ordering belongs to SearchEngine; `limit` stays here because how many
 * results are useful is intrinsic to the domain.
 *
 * Providers are stateless and independent: none reads another's output,
 * imports another, or assumes one has already run. That is what lets the
 * engine run them all in parallel.
 */
export interface SearchProvider {
  id: string;
  kind: ResultKind;
  /** Tab label. */
  title: string;
  enabled(context: SearchContext): boolean;
  search(query: string, context: SearchContext): Promise<SearchHit[]>;
}
