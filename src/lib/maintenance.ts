import fs from 'node:fs/promises';
import path from 'node:path';
import { historyFile, projectsDir } from './paths.js';
import { discoverProjects, sessionFolderStats, type Project } from './projects.js';
import { formatKb } from './format.js';

export interface HealthReport {
  brokenPaths: Project[];
  orphans: Project[];
  missingSessionFolders: Project[];
  text: string;
}

/**
 * Health check across all projects:
 * - history entries whose project directory no longer exists
 * - orphaned session folders with no resolvable project path
 * - projects with history but no session folder
 */
export async function healthCheck(): Promise<HealthReport> {
  const projects = await discoverProjects();
  const brokenPaths = projects.filter((p) => !p.orphaned && !p.exists);
  const orphans = projects.filter((p) => p.orphaned);
  const missingSessionFolders = projects.filter((p) => !p.orphaned && p.sessions === 0);

  const lines: string[] = ['Claude Code project health check', ''];

  if (brokenPaths.length > 0) {
    lines.push(`Missing project directories (${brokenPaths.length}):`);
    for (const p of brokenPaths) lines.push(`  ${p.path}`);
    lines.push('  The path moved or was deleted. Sessions are still stored.');
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

  return { brokenPaths, orphans, missingSessionFolders, text: lines.join('\n') };
}

/**
 * Delete orphaned session folders. Only folders inside the projects
 * directory that discovery marked as orphaned are removed.
 */
export async function pruneOrphans(): Promise<string> {
  const { orphans } = await healthCheck();
  if (orphans.length === 0) {
    return 'Nothing to prune: no orphaned session folders found.';
  }
  const lines: string[] = [];
  for (const orphan of orphans) {
    const target = path.join(projectsDir(), orphan.encoded);
    // Resolve and re-check containment so a weird folder name can never
    // escape the projects directory.
    const resolved = path.resolve(target);
    if (!resolved.startsWith(path.resolve(projectsDir()) + path.sep)) {
      lines.push(`Skipped suspicious path: ${orphan.encoded}`);
      continue;
    }
    await fs.rm(resolved, { recursive: true, force: true });
    lines.push(`Removed ${orphan.encoded} (${formatKb(orphan.sessionSizeKb)})`);
  }
  lines.push('', `Pruned ${orphans.length} orphaned session folder(s).`);
  return lines.join('\n');
}

/** Detailed text info for a single project, used by the info overlay. */
export async function projectInfoText(project: Project): Promise<string> {
  const dir = path.join(projectsDir(), project.encoded);
  const stats = await sessionFolderStats(dir);

  let historyEntries = 0;
  try {
    const content = await fs.readFile(historyFile(), 'utf8');
    const needle = `"project":${JSON.stringify(project.path)}`;
    for (const line of content.split('\n')) {
      if (line.includes(needle)) historyEntries += 1;
    }
  } catch {
    // no history file
  }

  const lines = [
    `Project: ${project.path}`,
    `Encoded folder: ${project.encoded}`,
    `Project directory: ${project.orphaned ? 'unknown' : project.exists ? 'exists' : 'missing'}`,
    `Sessions: ${stats.count} file(s), ${formatKb(stats.sizeKb)}`,
    `History entries: ${historyEntries}`,
  ];
  if (stats.lastActivity > 0) {
    lines.push(`Last activity: ${new Date(stats.lastActivity * 1000).toLocaleString()}`);
  }
  return lines.join('\n');
}
