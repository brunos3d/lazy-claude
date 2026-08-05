import type { ActionProvider, ActionSpec } from '../types.js';

/**
 * Operations on the workspace as a whole.
 *
 * Every one of these used to sit in the `x` menu's Maintenance category
 * while reading nothing from the selection, which is what made that menu
 * feel like a list of everything the program can do. They moved here; `x`
 * kept only what acts on the highlighted row.
 *
 * Repair is the exception that stayed in both. `startRepair` targets the
 * selected project when its directory is missing and otherwise opens a
 * picker over every broken project, so the two entry points genuinely do
 * different things.
 */
export const WorkspaceActions: ActionProvider = {
  id: 'workspace',
  category: 'workspace',

  list(context) {
    const { handlers } = context;

    const actions: ActionSpec[] = [
      {
        id: 'workspace.rescan',
        title: 'Rescan workspace',
        subtitle: 'Rediscover projects and sessions from disk',
        keywords: ['refresh', 'reload', 'scan', 'update', 'discover'],
        run: handlers.rescan,
      },
      {
        id: 'workspace.metadata',
        title: 'Refresh session metadata',
        subtitle: 'Clear the title cache and re-read every session',
        keywords: ['titles', 'cache', 'rebuild', 'reload', 'names'],
        run: handlers.refreshMetadata,
      },
      {
        id: 'workspace.repair',
        title: 'Repair broken references',
        subtitle: 'Relink sessions whose project directory moved',
        keywords: ['broken', 'missing', 'relink', 'moved', 'fix', 'references'],
        run: handlers.repairReferences,
      },
      {
        id: 'workspace.health',
        title: 'Run health check',
        subtitle: 'Find broken references and orphaned data',
        keywords: ['integrity', 'check', 'doctor', 'verify', 'broken', 'repair'],
        run: handlers.healthCheck,
      },
      {
        id: 'workspace.diagnostics',
        title: 'Run diagnostics',
        subtitle: 'Environment summary and workspace counts',
        keywords: ['doctor', 'debug', 'environment', 'info', 'version'],
        run: handlers.diagnostics,
      },
      {
        id: 'workspace.backups',
        title: 'History backups',
        subtitle: 'Create, restore, or delete history.jsonl backups',
        keywords: ['backup', 'restore', 'snapshot', 'history', 'recover'],
        run: handlers.backupManager,
      },
      {
        id: 'workspace.unpack',
        title: 'Unpack archive',
        subtitle: 'Restore a .claudepack to a new location',
        keywords: ['claudepack', 'import', 'extract', 'restore', 'archive'],
        run: handlers.unpackArchive,
      },
      {
        id: 'workspace.prune',
        title: 'Prune orphaned folders',
        subtitle: 'Delete session folders with no project',
        keywords: ['orphan', 'cleanup', 'delete', 'remove', 'garbage'],
        danger: true,
        run: handlers.pruneOrphans,
      },
    ];

    return actions;
  },
};
