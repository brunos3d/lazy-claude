import os from 'node:os';
import { shortenPath } from '../../core/format.js';
import { DiscoveryService, type Project } from '../DiscoveryService.js';
import { SessionMetadataService } from '../SessionMetadataService.js';
import { listAllArchivedSessions, listAllSessions } from '../SessionService.js';
import type { WorkspaceIndex } from './types.js';

type Listener = (index: WorkspaceIndex) => void;

function emptyIndex(): WorkspaceIndex {
  return {
    projects: [],
    sessions: [],
    metadata: new Map(),
    projectLabels: new Map(),
    home: os.homedir(),
    status: 'empty',
    done: 0,
    total: 0,
  };
}

/**
 * The workspace snapshot every search provider reads.
 *
 * Built once in the background and reused, so opening the palette never
 * triggers a scan and never waits for one. Queries run entirely against
 * what is already in memory; a build in flight simply means fewer results
 * for a moment, never a blocked interface.
 *
 * Builds are generation-stamped. `invalidate()` bumps the generation, so a
 * build racing against a rescan discards its own results instead of
 * publishing a stale snapshot over a fresh one.
 *
 * The generation stamp only suppresses publishing; the reads it started
 * keep going. Each build therefore also owns an AbortController that
 * `abort()` trips, so abandoning a build really does stop its IO instead
 * of stacking full workspace scans behind a few quick refreshes.
 */
class SearchIndexerImpl {
  private index: WorkspaceIndex = emptyIndex();
  private listeners = new Set<Listener>();
  private building: { generation: number; promise: Promise<void> } | null = null;
  private controller: AbortController | null = null;
  private generation = 0;

  snapshot(): WorkspaceIndex {
    return this.index;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Start a background build, or join the one already running. Callers
   * fire and forget: the palette reads `snapshot()` and re-renders from
   * `subscribe()` instead of awaiting this.
   *
   * `projects` lets App hand over the list its own discovery effect just
   * produced, so discovery does not run twice on startup.
   */
  warm(projects?: Project[]): Promise<void> {
    if (this.building) return this.building.promise;
    const generation = ++this.generation;
    // A fresh controller per build, so an earlier abort never carries over
    // and leaves the new build finishing zero batches.
    const controller = new AbortController();
    this.controller = controller;
    const promise = this.build(generation, controller.signal, projects).finally(() => {
      if (this.building?.generation === generation) this.building = null;
      if (this.controller === controller) this.controller = null;
    });
    this.building = { generation, promise };
    return promise;
  }

  /**
   * Abandon the build in flight and stop its reads.
   *
   * The TUI calls this on teardown: nothing calls `process.exit()`, so a
   * metadata pass still walking the workspace keeps Node alive and delays
   * the shell prompt by seconds.
   */
  abort(): void {
    this.generation += 1;
    this.controller?.abort();
    this.controller = null;
    this.building = null;
  }

  /** Drop the snapshot and abandon any build in flight. */
  invalidate(): void {
    this.abort();
    this.index = emptyIndex();
    this.publish();
  }

  private async build(
    generation: number,
    signal: AbortSignal,
    seed?: Project[],
  ): Promise<void> {
    const home = os.homedir();
    const projects = seed ?? (await DiscoveryService.discoverProjects());
    if (generation !== this.generation) return;

    const projectLabels = new Map<string, string>();
    for (const project of projects) {
      projectLabels.set(
        project.encoded,
        project.orphaned ? project.encoded : shortenPath(project.path, home),
      );
    }

    this.index = {
      ...emptyIndex(),
      home,
      projects,
      projectLabels,
      status: 'building',
    };
    this.publish();

    // Archived sessions are indexed too, so the palette can find a session
    // the user hid and flip the archived toggle on the way to it.
    const [live, archived] = await Promise.all([listAllSessions(), listAllArchivedSessions()]);
    if (generation !== this.generation) return;

    const sessions = [...live, ...archived];
    this.index = { ...this.index, sessions, total: sessions.length };
    this.publish();

    const metadata = await SessionMetadataService.getMany(
      sessions,
      (progress) => {
        if (generation !== this.generation) return;
        this.index = {
          ...this.index,
          metadata: progress.metadata,
          done: progress.done,
          total: progress.total,
        };
        this.publish();
      },
      signal,
    );
    if (generation !== this.generation) return;

    this.index = {
      ...this.index,
      metadata,
      status: 'ready',
      done: sessions.length,
      total: sessions.length,
    };
    this.publish();
  }

  private publish(): void {
    for (const listener of this.listeners) listener(this.index);
  }
}

export const SearchIndexer = new SearchIndexerImpl();
