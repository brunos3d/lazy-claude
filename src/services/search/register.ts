import { SearchEngine } from './SearchEngine.js';
import { ActionProvider } from './providers/ActionProvider.js';
import { ConversationProvider } from './providers/ConversationProvider.js';
import { ProjectProvider } from './providers/ProjectProvider.js';
import { SessionProvider } from './providers/SessionProvider.js';

let registered = false;

/**
 * Wire the built-in providers into the engine.
 *
 * Kept out of SearchEngine so the engine does not import its own
 * providers: that would make it impossible to test the orchestration on
 * its own, and would couple adding a provider to editing the engine.
 */
export function registerDefaultProviders(): void {
  if (registered) return;
  registered = true;
  SearchEngine.register(ProjectProvider);
  SearchEngine.register(SessionProvider);
  SearchEngine.register(ConversationProvider);
  SearchEngine.register(ActionProvider);
}
