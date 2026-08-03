export interface ParsedArgs {
  positional: string[];
  flags: {
    dryRun: boolean;
    force: boolean;
    parents: boolean;
    here: boolean;
    json: boolean;
    noBackup: boolean;
    from?: string;
    to?: string;
  };
}

/** Minimal flag parser shared by all commands. Unknown flags throw. */
export function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    positional: [],
    flags: {
      dryRun: false,
      force: false,
      parents: false,
      here: false,
      json: false,
      noBackup: false,
    },
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '-n':
      case '--dry-run':
        parsed.flags.dryRun = true;
        break;
      case '-f':
      case '--force':
        parsed.flags.force = true;
        break;
      case '-p':
      case '--parents':
        parsed.flags.parents = true;
        break;
      case '--here':
        parsed.flags.here = true;
        break;
      case '--json':
        parsed.flags.json = true;
        break;
      case '--no-backup':
        parsed.flags.noBackup = true;
        break;
      case '--from':
        parsed.flags.from = argv[++i];
        break;
      case '--to':
        parsed.flags.to = argv[++i];
        break;
      default:
        if (arg.startsWith('-') && arg !== '-') {
          throw new Error(`Unknown flag: ${arg}`);
        }
        parsed.positional.push(arg);
    }
  }
  return parsed;
}
