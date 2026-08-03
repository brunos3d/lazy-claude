import {
  formatBytes,
  formatClock,
  formatDuration,
  formatKb,
  formatRelativeTime,
  formatTokens,
} from '../core/format.js';
import { ConversationService } from '../services/ConversationService.js';
import { SessionMetadataService } from '../services/SessionMetadataService.js';
import { SearchService, toSearchDocument } from '../services/SearchService.js';
import { BackupService } from '../services/BackupService.js';
import { DiagnosticsService } from '../services/DiagnosticsService.js';
import { DiscoveryService } from '../services/DiscoveryService.js';
import { MoveService } from '../services/MoveService.js';
import { PackService } from '../services/PackService.js';
import { ProjectService } from '../services/ProjectService.js';
import { RepairService } from '../services/RepairService.js';
import {
  archiveSession,
  deleteSession,
  findSessionById,
  listAllArchivedSessions,
  listAllSessions,
  restoreSession,
  validateSession,
} from '../services/SessionService.js';
import { parseArgs, type ParsedArgs } from './args.js';
import { confirm, pick } from './prompt.js';

type Command = (args: ParsedArgs) => Promise<number>;

function printSteps(steps: string[]): void {
  for (const step of steps) console.log(step);
}

const commands: Record<string, Command> = {
  async list({ flags }) {
    const projects = await DiscoveryService.discoverProjects();
    projects.sort((a, b) => b.lastActivity - a.lastActivity);
    if (flags.json) {
      console.log(JSON.stringify(projects, null, 2));
      return 0;
    }
    for (const p of projects) {
      const marker = p.orphaned ? 'orphan ' : p.exists ? '       ' : 'missing';
      console.log(
        `${marker} ${p.orphaned ? p.encoded : p.path} (${p.sessions} sessions, ${formatKb(p.sessionSizeKb)})`,
      );
    }
    const broken = projects.filter((p) => !p.exists && !p.orphaned).length;
    console.log(
      `\n${projects.length} projects, ${broken} with missing paths. Run 'lazy-claude repair' to relink.`,
    );
    return 0;
  },

  async sessions({ positional, flags }) {
    const archived = positional[0] === 'archived';
    const sessions = archived ? await listAllArchivedSessions() : await listAllSessions();
    const metadata = await SessionMetadataService.getMany(sessions);
    if (flags.json) {
      console.log(
        JSON.stringify(
          sessions.map((s) => ({ ...s, metadata: metadata.get(s.file) ?? null })),
          null,
          2,
        ),
      );
      return 0;
    }
    for (const s of sessions) {
      const meta = metadata.get(s.file);
      console.log(meta?.title ?? s.id);
      console.log(
        `  ${s.id.slice(0, 8)} · ${formatRelativeTime(s.modifiedAt)} · ${formatBytes(s.sizeBytes)}` +
          (meta?.gitBranch ? ` · ${meta.gitBranch}` : '') +
          (archived ? ' · archived' : ''),
      );
    }
    console.log(`\n${sessions.length} ${archived ? 'archived ' : ''}sessions`);
    return 0;
  },

  async search({ positional, flags }) {
    const query = positional.join(' ');
    if (!query.trim()) {
      console.error('Usage: lazy-claude search <query>');
      return 1;
    }
    const sessions = [...(await listAllSessions()), ...(await listAllArchivedSessions())];
    const metadata = await SessionMetadataService.getMany(sessions);
    // Resolve each session's CURRENT project, not the cwd baked into the
    // file, which stays at the old location after a move.
    const byEncoded = new Map(
      (await DiscoveryService.discoverProjects())
        .filter((p) => !p.orphaned)
        .map((p) => [p.encoded, p.path]),
    );
    const pathOf = (s: (typeof sessions)[number]) =>
      byEncoded.get(s.encoded) ?? metadata.get(s.file)?.cwd ?? s.encoded;
    const matches = sessions.filter((s) =>
      SearchService.matchesSession(toSearchDocument(s, metadata.get(s.file), pathOf(s)), query),
    );
    if (flags.json) {
      console.log(
        JSON.stringify(
          matches.map((s) => ({ ...s, metadata: metadata.get(s.file) ?? null })),
          null,
          2,
        ),
      );
      return 0;
    }
    for (const s of matches) {
      console.log(metadata.get(s.file)?.title ?? s.id);
      console.log(`  ${s.id.slice(0, 8)} · ${formatRelativeTime(s.modifiedAt)} · ${pathOf(s)}`);
    }
    console.log(`\n${matches.length} of ${sessions.length} sessions match "${query}"`);
    return matches.length > 0 ? 0 : 1;
  },

  async show({ positional, flags }) {
    const id = positional[0];
    if (!id) {
      console.error('Usage: lazy-claude show <session-id>');
      return 1;
    }
    const session = await findSessionById(id);
    if (!session) {
      console.error(`Session not found: ${id}`);
      return 1;
    }
    const meta = await SessionMetadataService.get(session);
    const conversation = await ConversationService.analyze(session);
    if (flags.json) {
      console.log(JSON.stringify({ session, metadata: meta, conversation }, null, 2));
      return 0;
    }

    const { stats } = conversation;
    console.log(meta.title);
    console.log('='.repeat(Math.min(meta.title.length, 72)));
    console.log(`Session:   ${session.id}`);
    console.log(`Project:   ${meta.cwd ?? session.encoded}`);
    if (meta.gitBranch) console.log(`Branch:    ${meta.gitBranch}`);
    if (meta.relocatedCwd) console.log(`Relocated: ${meta.relocatedCwd}`);
    console.log(
      `Modified:  ${formatRelativeTime(session.modifiedAt)} (${session.modifiedAt.toLocaleString()})`,
    );
    console.log(`Size:      ${formatBytes(session.sizeBytes)}${session.archived ? ' [archived]' : ''}`);
    if (meta.version) console.log(`Version:   Claude Code ${meta.version}`);
    console.log('');
    console.log('Statistics');
    console.log(`  Messages:   ${stats.userMessages} user / ${stats.assistantMessages} assistant`);
    console.log(`  Tool calls: ${stats.toolCalls}`);
    console.log(`  Files:      ${stats.filesTouched.length} touched, ${stats.filesCreated.length} created`);
    if (stats.inputTokens > 0) {
      console.log(`  Tokens:     ${formatTokens(stats.inputTokens)} in / ${formatTokens(stats.outputTokens)} out`);
    }
    if (stats.durationMs > 0) console.log(`  Duration:   ${formatDuration(stats.durationMs)}`);
    if (stats.models.length > 0) console.log(`  Model:      ${stats.models.join(', ')}`);

    const tools = ConversationService.topTools(stats);
    if (tools.length > 0) {
      console.log('');
      console.log('Top tools');
      for (const [name, count] of tools) console.log(`  ${name.padEnd(14)} ${count}`);
    }
    if (conversation.preview.length > 0) {
      console.log('');
      console.log('Preview');
      for (const exchange of conversation.preview) {
        console.log(`  ${exchange.role === 'user' ? 'User' : 'Assistant'}: ${exchange.text}`);
      }
    }
    if (conversation.timeline.length > 0) {
      console.log('');
      console.log('Timeline');
      for (const event of conversation.timeline.slice(0, 20)) {
        console.log(`  ${formatClock(event.timestamp)}  ${event.label}`);
      }
    }
    return 0;
  },

  async info({ positional, flags }) {
    const target = positional[0] ?? process.cwd();
    const info = await ProjectService.info(target);
    if (flags.json) {
      console.log(JSON.stringify(info, null, 2));
      return 0;
    }
    console.log(`Project: ${info.path}`);
    console.log(`Encoded folder: ${info.encoded}`);
    console.log(`Project directory: ${info.projectExists ? 'exists' : 'missing'}`);
    if (info.projectExists) console.log(`Project size: ${formatKb(info.projectSizeKb)}`);
    console.log(`.claude settings: ${info.hasClaudeSettings ? 'found' : 'not found'}`);
    console.log(
      `Sessions: ${info.sessionCount} file(s), ${formatKb(info.sessionSizeKb)}` +
        (info.archivedCount > 0 ? ` (+${info.archivedCount} archived)` : ''),
    );
    if (info.newestSession) console.log(`Newest session: ${info.newestSession.toLocaleString()}`);
    if (info.oldestSession) console.log(`Oldest session: ${info.oldestSession.toLocaleString()}`);
    console.log(
      `History entries: ${info.historyEntries.exact} (${info.historyEntries.nested} nested)`,
    );
    return 0;
  },

  async move({ positional, flags }) {
    const source = positional[0];
    if (!source) {
      console.error('Usage: lazy-claude move <source> <destination> [-n] [-f] [-p] [--here]');
      return 1;
    }
    const options = {
      source,
      destination: positional[1],
      here: flags.here,
      parents: flags.parents,
      dryRun: flags.dryRun,
      backup: !flags.noBackup,
    };
    const { source: from, destination: to } = await MoveService.resolve(options);
    if (
      !flags.dryRun &&
      !(await confirm(`Move ${from}\n  -> ${to}\nand migrate all session references?`, flags.force))
    ) {
      return 1;
    }
    const report = await MoveService.move(options);
    printSteps(report.steps);
    if (!report.dryRun) {
      console.log(`\nDone. Resume with: cd ${report.destination} && claude --continue`);
    }
    return 0;
  },

  async repair({ positional, flags }) {
    // Explicit mode
    if (flags.from && flags.to) {
      const plan = await RepairService.repair({
        from: flags.from,
        to: flags.to,
        dryRun: true,
        backup: !flags.noBackup,
      });
      printSteps(plan.steps);
      if (flags.dryRun || plan.changes === 0) return 0;
      if (!(await confirm('Apply repair?', flags.force))) return 1;
      const report = await RepairService.repair({
        from: flags.from,
        to: flags.to,
        backup: !flags.noBackup,
      });
      printSteps(report.steps);
      return 0;
    }

    // Detect-old mode: repair <new-path>
    if (positional[0]) {
      const matches = await RepairService.matchBrokenByName(positional[0]);
      if (matches.length === 0) {
        console.error(`No broken references found matching '${positional[0]}'`);
        console.error(`Try: lazy-claude repair --from <old-path> --to ${positional[0]}`);
        return 1;
      }
      let from = matches[0].path;
      if (matches.length > 1 && !flags.force) {
        const picked = await pick(
          'Multiple broken references found. Select which to repair',
          matches.map((m) => m.path),
        );
        if (!picked) return 1;
        from = picked;
      }
      const report = await RepairService.repair({
        from,
        to: positional[0],
        dryRun: flags.dryRun,
        backup: !flags.noBackup,
      });
      printSteps(report.steps);
      return 0;
    }

    // Full auto mode
    const broken = await RepairService.findBrokenReferences();
    if (broken.length === 0) {
      console.log('No broken references found. Everything looks good.');
      return 0;
    }
    console.log(`Found ${broken.length} broken reference(s):\n`);
    let fixed = 0;
    for (const b of broken) {
      console.log(`  x ${b.path}`);
      const candidates = await RepairService.findCandidates(b);
      if (candidates.length === 0) {
        console.log(`    No matching directory found. Use: lazy-claude repair --from "${b.path}" --to <new-path>\n`);
        continue;
      }
      let target: string | null = null;
      if (flags.dryRun) {
        console.log(`    Would repair to: ${candidates[0]}\n`);
        continue;
      }
      if (candidates.length === 1) {
        target = (flags.force || (await confirm(`    Repair to ${candidates[0]}?`, false)))
          ? candidates[0]
          : null;
      } else if (flags.force) {
        target = candidates[0];
      } else {
        target = await pick('    Select match', candidates);
      }
      if (!target) {
        console.log('');
        continue;
      }
      const report = await RepairService.repair({ from: b.path, to: target, backup: !flags.noBackup });
      printSteps(report.steps.map((s) => `    ${s}`));
      fixed += 1;
      console.log('');
    }
    console.log(`Repaired ${fixed} of ${broken.length} broken reference(s).`);
    return 0;
  },

  async remove({ positional, flags }) {
    const target = positional[0];
    if (!target) {
      console.error('Usage: lazy-claude remove <project-path> [-n] [-f] [--no-backup]');
      return 1;
    }
    if (
      !flags.dryRun &&
      !(await confirm(
        `Permanently delete ${target} including ALL session data? This cannot be undone.`,
        flags.force,
      ))
    ) {
      return 1;
    }
    const report = await ProjectService.remove({
      path: target,
      dryRun: flags.dryRun,
      backup: !flags.noBackup,
    });
    printSteps(report.steps);
    return 0;
  },

  async pack({ positional, flags }) {
    const source = positional[0];
    if (!source) {
      console.error('Usage: lazy-claude pack <project-path> [archive-path] [-f]');
      return 1;
    }
    const report = await PackService.pack({
      source,
      archive: positional[1],
      force: flags.force,
    });
    printSteps(report.steps);
    console.log(`\nUnpack elsewhere with: lazy-claude unpack ${report.archive} <destination>`);
    return 0;
  },

  async unpack({ positional, flags }) {
    const [archive, destination] = positional;
    if (!archive || !destination) {
      console.error('Usage: lazy-claude unpack <archive.claudepack> <destination> [-f] [-p]');
      return 1;
    }
    const report = await PackService.unpack({
      archive,
      destination,
      force: flags.force,
      parents: flags.parents,
      backup: !flags.noBackup,
    });
    printSteps(report.steps);
    console.log(`\nDone. Resume with: cd ${report.destination} && claude --continue`);
    return 0;
  },

  async prune({ flags }) {
    const preview = await DiagnosticsService.pruneOrphans(true);
    if (preview.removed.length === 0) {
      console.log(preview.text);
      return 0;
    }
    console.log(preview.text);
    if (flags.dryRun) return 0;
    if (
      !(await confirm(
        `Permanently delete ${preview.removed.length} orphaned session folder(s)?`,
        flags.force,
      ))
    ) {
      return 1;
    }
    const report = await DiagnosticsService.pruneOrphans(false);
    console.log(report.text);
    return 0;
  },

  async verify() {
    const report = await DiagnosticsService.healthCheck();
    console.log(report.text);
    return report.brokenPaths.length + report.orphans.length > 0 ? 1 : 0;
  },

  async doctor() {
    console.log(await DiagnosticsService.doctor());
    return 0;
  },

  async backup({ positional, flags }) {
    const sub = positional[0] ?? 'list';
    if (sub === 'create') {
      const file = await BackupService.create();
      console.log(file ? `Created backup: ${file}` : 'No history file to back up.');
      return 0;
    }
    if (sub === 'list') {
      const backups = await BackupService.list();
      if (backups.length === 0) {
        console.log('No history backups found.');
        return 0;
      }
      for (const b of backups) {
        console.log(`${b.name}  ${b.createdAt.toLocaleString()}  ${formatBytes(b.sizeBytes)}`);
      }
      return 0;
    }
    if (sub === 'restore') {
      const name = positional[1];
      if (!name) {
        console.error('Usage: lazy-claude backup restore <backup-file-or-name>');
        return 1;
      }
      const backups = await BackupService.list();
      const match = backups.find((b) => b.name === name || b.file === name);
      if (!match) {
        console.error(`Backup not found: ${name}`);
        return 1;
      }
      if (!(await confirm(`Replace history.jsonl with ${match.name}?`, flags.force))) return 1;
      const { preRestoreBackup } = await BackupService.restore(match.file);
      console.log(`Restored history.jsonl from ${match.name}`);
      if (preRestoreBackup) console.log(`Previous state saved as: ${preRestoreBackup}`);
      return 0;
    }
    if (sub === 'delete') {
      const name = positional[1];
      const backups = await BackupService.list();
      const match = backups.find((b) => b.name === name || b.file === name);
      if (!match) {
        console.error(`Backup not found: ${name ?? '(none given)'}`);
        return 1;
      }
      if (!(await confirm(`Delete backup ${match.name}?`, flags.force))) return 1;
      await BackupService.delete(match.file);
      console.log(`Deleted ${match.name}`);
      return 0;
    }
    console.error(`Unknown backup subcommand: ${sub} (use create, list, restore, delete)`);
    return 1;
  },

  async session({ positional, flags }) {
    const [sub, id] = positional;
    if (!sub || !id || !['archive', 'restore', 'delete', 'check'].includes(sub)) {
      console.error('Usage: lazy-claude session <archive|restore|delete|check> <session-id>');
      return 1;
    }
    const session = await findSessionById(id, { preferArchived: sub === 'restore' });
    if (!session) {
      console.error(`Session not found: ${id}`);
      return 1;
    }
    if (sub === 'check') {
      const integrity = await validateSession(session);
      console.log(
        `${session.id}: ${integrity.validRecords}/${integrity.totalLines} valid records` +
          (integrity.ok ? ' (ok)' : ` (${integrity.invalidLines} invalid lines)`),
      );
      return integrity.ok ? 0 : 1;
    }
    if (sub === 'archive') {
      if (session.archived) {
        console.error(`Session is already archived: ${session.id}`);
        return 1;
      }
      await archiveSession(session);
      console.log(`Archived ${session.id}`);
      return 0;
    }
    if (sub === 'restore') {
      if (!session.archived) {
        console.error(`Session is not archived: ${session.id}`);
        return 1;
      }
      await restoreSession(session);
      console.log(`Restored ${session.id}`);
      return 0;
    }
    if (!(await confirm(`Permanently delete session ${session.id}?`, flags.force))) return 1;
    await deleteSession(session);
    console.log(`Deleted ${session.id}`);
    return 0;
  },
};

export async function runCommand(name: string, argv: string[]): Promise<number> {
  const command = commands[name];
  if (!command) return -1;
  return command(parseArgs(argv));
}

export const commandNames = Object.keys(commands);
