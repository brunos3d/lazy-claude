import type { SearchProvider } from '../types.js';

/**
 * Message search across conversation content.
 *
 * Disabled because no message index exists yet, so SearchEngine skips it
 * and the Messages group never renders. It ships registered so the shape
 * of the system is settled: nothing in SearchEngine, CommandPalette, or
 * useJumpTarget changes when it starts returning hits.
 *
 * Implementing it means indexing user prompts, assistant text, tool names,
 * and file paths keyed by session file, invalidated on size and mtime the
 * way MetadataCache is, then returning hits whose target carries the
 * record offset as `anchor`. That needs a full pass over every session
 * file, which is why it is not done inline: session files reach multiple
 * megabytes and the rest of the app deliberately never reads one whole.
 *
 * Returning partial results from the head/tail chunks the metadata parser
 * already reads was considered and rejected. That text is where session
 * titles come from, so those hits would duplicate the Sessions group.
 */
export const ConversationProvider: SearchProvider = {
  id: 'conversations',
  kind: 'message',
  title: 'Messages',

  enabled: () => false,

  async search() {
    return [];
  },
};
