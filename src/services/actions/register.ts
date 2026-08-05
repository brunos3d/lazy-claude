import { ActionRegistry } from './ActionRegistry.js';
import { FilterActions } from './providers/FilterActions.js';
import { InsightActions } from './providers/InsightActions.js';
import { SortActions } from './providers/SortActions.js';
import { WorkspaceActions } from './providers/WorkspaceActions.js';

/**
 * The default provider set.
 *
 * Registration is idempotent (the registry replaces by id), so calling this
 * more than once is safe. Order does not matter: CATEGORY_ORDER decides
 * where each provider's actions land.
 */
export function registerDefaultActions(): void {
  ActionRegistry.register(SortActions);
  ActionRegistry.register(FilterActions);
  ActionRegistry.register(WorkspaceActions);
  ActionRegistry.register(InsightActions);
}
