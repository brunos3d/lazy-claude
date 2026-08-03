import readline from 'node:readline/promises';

/**
 * Interactive confirmation for destructive CLI commands. Skipped with
 * --force; refused outright when stdin is not a terminal, so scripts must
 * pass --force explicitly instead of hanging.
 */
export async function confirm(question: string, force: boolean): Promise<boolean> {
  if (force) return true;
  if (!process.stdin.isTTY) {
    console.error('Refusing to proceed without confirmation. Pass --force in non-interactive use.');
    return false;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${question} [y/N] `);
    return /^y$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

/** Numbered pick from a list; returns null on invalid/empty input. */
export async function pick(prompt: string, options: string[]): Promise<string | null> {
  if (!process.stdin.isTTY) return null;
  for (let i = 0; i < options.length; i++) {
    console.log(`  ${i + 1}) ${options[i]}`);
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${prompt} (1-${options.length}, Enter to skip): `);
    const index = Number.parseInt(answer.trim(), 10);
    if (Number.isInteger(index) && index >= 1 && index <= options.length) {
      return options[index - 1];
    }
    return null;
  } finally {
    rl.close();
  }
}
