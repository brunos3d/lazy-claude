import path from 'node:path';
import { DiscoveryService, type Project } from './DiscoveryService.js';

export interface WorkspaceMatch {
  project: Project;
  /** exact: the cwd is the project. ancestor: the project contains the cwd. */
  how: 'exact' | 'ancestor';
}

/**
 * Resolves a working directory to a known Claude Code project, so
 * `lazy-claude .` can open straight into the right project the way
 * lazygit opens in the current repository.
 */
class WorkspaceResolverImpl {
  /**
   * Find the project for a directory. An exact match wins; otherwise the
   * closest ancestor project is used, which handles running from a
   * subdirectory of the project.
   */
  async resolve(dir: string, projects?: Project[]): Promise<WorkspaceMatch | null> {
    const target = path.resolve(dir);
    const all = projects ?? (await DiscoveryService.discoverProjects());

    const exact = all.find((p) => !p.orphaned && p.path === target);
    if (exact) return { project: exact, how: 'exact' };

    let best: Project | null = null;
    for (const project of all) {
      if (project.orphaned) continue;
      const prefix = project.path.endsWith(path.sep) ? project.path : project.path + path.sep;
      if (!target.startsWith(prefix)) continue;
      if (!best || project.path.length > best.path.length) best = project;
    }
    return best ? { project: best, how: 'ancestor' } : null;
  }

  /**
   * True when an argument should be treated as a workspace to open rather
   * than a command. Covers `.`, `..`, `~`, and any absolute or relative
   * path, so `lazy-claude .` and `lazy-claude ~/code/app` behave the same.
   */
  looksLikePath(arg: string | undefined): boolean {
    if (!arg) return false;
    return (
      arg === '.' ||
      arg === '..' ||
      arg === '~' ||
      arg.startsWith('./') ||
      arg.startsWith('../') ||
      arg.startsWith('~/') ||
      arg.startsWith('/') ||
      arg.startsWith('\\') ||
      /^[a-zA-Z]:[\\/]/.test(arg)
    );
  }
}

export const WorkspaceResolver = new WorkspaceResolverImpl();
