import fs from 'node:fs/promises';
import path from 'node:path';
import { claudeDir, historyFile, projectsDir } from '../core/paths.js';
import { exists } from '../core/fsx.js';
import { formatKb } from '../core/format.js';
import { DiscoveryService, type Project } from './DiscoveryService.js';
import { BackupService } from './BackupService.js';

export interface HealthReport {
  projects: Project[];
  brokenPaths: Project[];
  orphans: Project[];
  missingSessionFolders: Project[];
  text: string;
}

export interface PruneReport {
  removed: Array<{ encoded: string; sizeKb: number }>;
  steps: string[];
  text: string;
}

/** Environment-wide health checks and cleanup. */
export const DiagnosticsService = {
  /**
   * Health check across all projects:
   * - history entries whose project directory no longer exists
   * - orphaned session folders with no resolvable project path
   * - projects with history but no session folder
   */
  async healthCheck(): Promise<HealthReport> {
    const projects = await DiscoveryService.discoverProjects();
    const brokenPaths = projects.filter((p) => !p.orphaned && !p.exists);
    const orphans = projects.filter((p) => p.orphaned);
    const missingSessionFolders = projects.filter((p) => !p.orphaned && p.sessions === 0);

    const lines: string[] = ['Claude Code project health check', ''];
    if (brokenPaths.length > 0) {
      lines.push(`Missing project directories (${brokenPaths.length}):`);
      for (const p of brokenPaths) lines.push(`  ${p.path}`);
      lines.push('  The path moved or was deleted. Repair relinks the sessions.');
      lines.push('');
    }
    if (orphans.length > 0) {
      lines.push(`Orphaned session folders (${orphans.length}):`);
      for (const p of orphans) lines.push(`  ${p.encoded}`);
      lines.push('  No project path could be resolved. Prune removes these.');
      lines.push('');
    }
    if (missingSessionFolders.length > 0) {
      lines.push(`Projects with history but no sessions (${missingSessionFolders.length}):`);
      for (const p of missingSessionFolders) lines.push(`  ${p.path}`);
      lines.push('');
    }
    if (brokenPaths.length === 0 && orphans.length === 0 && missingSessionFolders.length === 0) {
      lines.push('Everything looks healthy.');
    }
    lines.push(`Checked ${projects.length} projects.`);

    return { projects, brokenPaths, orphans, missingSessionFolders, text: lines.join('\n') };
  },

  /**
   * Delete orphaned session folders. Only folders inside the projects
   * directory that discovery marked as orphaned are removed.
   */
  async pruneOrphans(dryRun = false): Promise<PruneReport> {
    const { orphans } = await this.healthCheck();
    if (orphans.length === 0) {
      const text = 'Nothing to prune: no orphaned session folders found.';
      return { removed: [], steps: [text], text };
    }
    const steps: string[] = [];
    const removed: PruneReport['removed'] = [];
    for (const orphan of orphans) {
      const target = path.resolve(projectsDir(), orphan.encoded);
      // Containment check so a weird folder name can never escape the
      // projects directory.
      if (!target.startsWith(path.resolve(projectsDir()) + path.sep)) {
        steps.push(`Skipped suspicious path: ${orphan.encoded}`);
        continue;
      }
      if (dryRun) {
        steps.push(`Would remove ${orphan.encoded} (${formatKb(orphan.sessionSizeKb)})`);
      } else {
        await fs.rm(target, { recursive: true, force: true });
        steps.push(`Removed ${orphan.encoded} (${formatKb(orphan.sessionSizeKb)})`);
      }
      removed.push({ encoded: orphan.encoded, sizeKb: orphan.sessionSizeKb });
    }
    steps.push(
      '',
      dryRun
        ? `Would prune ${removed.length} orphaned session folder(s).`
        : `Pruned ${removed.length} orphaned session folder(s).`,
    );
    return { removed, steps, text: steps.join('\n') };
  },

  /** Environment summary for the doctor command. */
  async doctor(): Promise<string> {
    const lines: string[] = [];
    lines.push(`claude dir: ${claudeDir()} ${(await exists(claudeDir())) ? '' : '(missing)'}`);
    lines.push(
      `projects dir: ${projectsDir()} ${(await exists(projectsDir())) ? '' : '(missing)'}`,
    );
    lines.push(
      `history file: ${historyFile()} ${(await exists(historyFile())) ? '' : '(missing)'}`,
    );
    const projects = await DiscoveryService.discoverProjects();
    const sessions = projects.reduce((sum, p) => sum + p.sessions, 0);
    const orphans = projects.filter((p) => p.orphaned).length;
    const broken = projects.filter((p) => !p.orphaned && !p.exists).length;
    lines.push(`projects: ${projects.length} (${broken} missing paths, ${orphans} orphaned)`);
    lines.push(`sessions: ${sessions}`);
    const backups = await BackupService.list();
    lines.push(`history backups: ${backups.length}`);
    return lines.join('\n');
  },
};
