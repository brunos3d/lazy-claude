import {
  CATEGORY_ORDER,
  type ActionContext,
  type ActionProvider,
  type WorkspaceAction,
} from './types.js';

/**
 * Builds the workspace action list from the registered providers.
 *
 * The category comes from the provider and is stamped on here, so an action
 * cannot claim a section its provider does not own. Ordering is the
 * registry's decision for the same reason SearchEngine owns GROUP_ORDER: the
 * same context should always put the same action in the same place, whatever
 * order the providers happened to register in.
 */
class ActionRegistryImpl {
  private providers: ActionProvider[] = [];

  register(provider: ActionProvider): void {
    this.providers = this.providers.filter((p) => p.id !== provider.id).concat(provider);
  }

  /** Drop every provider. Used by tests. */
  reset(): void {
    this.providers = [];
  }

  list(context: ActionContext): WorkspaceAction[] {
    const actions: WorkspaceAction[] = [];

    for (const category of CATEGORY_ORDER) {
      for (const provider of this.providers) {
        if (provider.category !== category) continue;
        for (const spec of provider.list(context)) {
          actions.push({ ...spec, category });
        }
      }
    }

    return actions;
  }
}

export const ActionRegistry = new ActionRegistryImpl();
