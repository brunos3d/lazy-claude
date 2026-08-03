import { chmodSync } from 'node:fs';

/**
 * Restore the executable bit on the CLI entry point after a build.
 *
 * tsc writes output as 0644. npm sets the bit on `bin` targets when it
 * links or installs a package, but a later rebuild overwrites the file
 * and drops it again, which leaves an already-linked `lazy-claude` or
 * `lzc` failing with "permission denied". Running this after every build
 * keeps a linked checkout working.
 *
 * chmod is a no-op on Windows, so this is safe cross-platform.
 */
try {
  chmodSync(new URL('../dist/cli.js', import.meta.url), 0o755);
} catch (error) {
  console.error(`Could not set the executable bit on dist/cli.js: ${error.message}`);
  process.exitCode = 1;
}
