import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LAUNCH_MODES, LaunchError, LauncherService } from './LauncherService.js';
import type { SessionEntry } from './SessionService.js';

/**
 * `prepare` validates against the real filesystem, so every case here gets a
 * throwaway project and session file. The Claude Code binary is faked with
 * the running node executable, which is the one file guaranteed to exist and
 * be executable on any machine that can run these tests.
 */
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lazy-claude-launch-'));
  const projectPath = path.join(root, 'project');
  await fs.mkdir(projectPath);
  const file = path.join(root, 'session.jsonl');
  await fs.writeFile(file, '{}\n');
  const session: SessionEntry = {
    id: 'aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa',
    encoded: '-tmp-project',
    file,
    sizeBytes: 3,
    modifiedAt: new Date(),
    archived: false,
  };
  return { root, projectPath, session };
}

function withFakeBinary<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env.LAZY_CLAUDE_CLAUDE_BIN;
  process.env.LAZY_CLAUDE_CLAUDE_BIN = process.execPath;
  return run().finally(() => {
    if (previous === undefined) delete process.env.LAZY_CLAUDE_CLAUDE_BIN;
    else process.env.LAZY_CLAUDE_CLAUDE_BIN = previous;
  });
}

test('a resume plan carries where to come back to', async () => {
  const { root, projectPath, session } = await fixture();
  try {
    const plan = await withFakeBinary(() =>
      LauncherService.prepare(session, projectPath, LAUNCH_MODES.resume),
    );
    // The interface re-mounts when Claude Code exits and needs this to land
    // on the session that was just being worked on.
    assert.deepEqual(plan.target, {
      kind: 'session',
      id: session.id,
      file: session.file,
      encoded: session.encoded,
    });
    assert.deepEqual(plan.args, ['--resume', session.id]);
    assert.equal(plan.cwd, projectPath);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('the dangerous mode carries the same target, and its flag', async () => {
  const { root, projectPath, session } = await fixture();
  try {
    const plan = await withFakeBinary(() =>
      LauncherService.prepare(session, projectPath, LAUNCH_MODES.resumeDangerous),
    );
    // Both resume modes come back the same way; only the arguments differ.
    assert.equal(plan.target.kind, 'session');
    assert.equal(plan.target.kind === 'session' && plan.target.id, session.id);
    assert.deepEqual(plan.args, ['--dangerously-skip-permissions', '--resume', session.id]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('an archived session refuses to launch, because Claude Code cannot see it', async () => {
  const { root, projectPath, session } = await fixture();
  try {
    await assert.rejects(
      () =>
        withFakeBinary(() =>
          LauncherService.prepare({ ...session, archived: true }, projectPath, LAUNCH_MODES.resume),
        ),
      LaunchError,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('a missing project directory fails before the interface exits', async () => {
  const { root, session } = await fixture();
  try {
    await assert.rejects(
      () =>
        withFakeBinary(() =>
          LauncherService.prepare(session, path.join(root, 'gone'), LAUNCH_MODES.resume),
        ),
      LaunchError,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('an unusable binary override is caught here, not at spawn time', async () => {
  const { root, projectPath, session } = await fixture();
  const previous = process.env.LAZY_CLAUDE_CLAUDE_BIN;
  process.env.LAZY_CLAUDE_CLAUDE_BIN = path.join(root, 'not-a-binary');
  try {
    await assert.rejects(
      () => LauncherService.prepare(session, projectPath, LAUNCH_MODES.resume),
      LaunchError,
    );
  } finally {
    if (previous === undefined) delete process.env.LAZY_CLAUDE_CLAUDE_BIN;
    else process.env.LAZY_CLAUDE_CLAUDE_BIN = previous;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('a new-session plan targets the project and never passes --resume', async () => {
  const { root, projectPath } = await fixture();
  try {
    const plan = await withFakeBinary(() =>
      LauncherService.prepareNew(projectPath, '-tmp-project', LAUNCH_MODES.newSession),
    );
    // There is no session yet, so the only place to come back to is the
    // project itself; the rediscovery on re-mount surfaces the new session.
    assert.deepEqual(plan.target, { kind: 'project', encoded: '-tmp-project' });
    assert.deepEqual(plan.args, []);
    assert.equal(plan.cwd, projectPath);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('the dangerous new-session mode carries its flag', async () => {
  const { root, projectPath } = await fixture();
  try {
    const plan = await withFakeBinary(() =>
      LauncherService.prepareNew(projectPath, '-tmp-project', LAUNCH_MODES.newSessionDangerous),
    );
    assert.deepEqual(plan.args, ['--dangerously-skip-permissions']);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('a missing project directory refuses a new session', async () => {
  const { root } = await fixture();
  try {
    await assert.rejects(
      () =>
        withFakeBinary(() =>
          LauncherService.prepareNew(path.join(root, 'gone'), '-gone', LAUNCH_MODES.newSession),
        ),
      LaunchError,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('a new session without a known project directory refuses to launch', async () => {
  const { root } = await fixture();
  try {
    await assert.rejects(
      () =>
        withFakeBinary(() =>
          LauncherService.prepareNew(undefined, '-orphan', LAUNCH_MODES.newSession),
        ),
      LaunchError,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('the pending plan is handed over exactly once', async () => {
  const { root, projectPath, session } = await fixture();
  try {
    const plan = await withFakeBinary(() =>
      LauncherService.prepare(session, projectPath, LAUNCH_MODES.resume),
    );
    LauncherService.request(plan);
    assert.equal(LauncherService.takePending(), plan);
    // A second read must be null, or the resume loop would relaunch on every
    // return instead of coming back to the interface.
    assert.equal(LauncherService.takePending(), null);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
