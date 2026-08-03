import type { Project } from '../services/DiscoveryService.js';

/** Which panel owns the keyboard. Tab cycles through them in this order. */
export type Focus = 'projects' | 'sessions' | 'details';

export const FOCUS_ORDER: Focus[] = ['projects', 'sessions', 'details'];

/** A row of the projects panel. "all" is a scope switch, not a project. */
export type ProjectItem = { kind: 'all' } | { kind: 'project'; project: Project };
