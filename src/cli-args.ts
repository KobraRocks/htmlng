/**
 * Parses and validates CLI arguments for `run` in `cli.ts` and the command
 * modules: flag tokens become a map, names are checked, and page/component
 * positional arguments are resolved.
 */
import { EngineError } from './types.js';

/** Flags that consume the following token as a value. */
const VALUE_FLAGS = new Set([
  '--page', '--name', '--port', '--before', '--after', '--preset', '--as-preset',
]);

/** Flags that stand alone. */
const BOOL_FLAGS = new Set([
  '--all', '--compact', '--with-css', '--watch', '--verbose', '--strict', '--json', '--help',
]);

export interface ParsedArgs {
  command: string;
  args: string[];
  flags: Map<string, string | true>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const parsed = new Map<string, string | true>();

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];

    if (token === '-h') { parsed.set('--help', true); continue; }
    if (token === '-' || !token.startsWith('-')) { positionals.push(token); continue; }

    if (VALUE_FLAGS.has(token)) {
      const value = argv[i + 1];
      if (value === undefined) {
        throw new EngineError(`Flag ${token} requires a value`, '', undefined, 'ERROR', 'Run: htmlng --help', 'CLI_FLAG_VALUE_MISSING');
      }
      parsed.set(token, value);
      i++;
      continue;
    }

    if (BOOL_FLAGS.has(token)) { parsed.set(token, true); continue; }

    throw new EngineError(`Unknown flag: ${token}`, '', undefined, 'ERROR', 'Run: htmlng --help', 'CLI_UNKNOWN_FLAG');
  }

  return { command: positionals[0] ?? '', args: positionals.slice(1), flags: parsed };
}

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** Require a scaffold/edit target name and reject values that could escape the project. */
export function requireName(value: string | undefined, label: string, usage: string): string {
  if (!value) {
    throw new EngineError(`Missing ${label} name`, '', undefined, 'ERROR', `Usage: ${usage}`, 'CLI_MISSING_NAME');
  }
  if (!NAME_RE.test(value)) {
    throw new EngineError(
      `Invalid ${label} name "${value}"`,
      '', undefined, 'ERROR',
      `Names must match ${NAME_RE} (letters, digits, "-" and "_"; no path separators).`,
      'CLI_INVALID_NAME',
    );
  }
  return value;
}

/** Resolve an optional page argument: `page <p>`, bare `<p>`, or undefined for all. */
export function pageTarget(args: string[]): string | undefined {
  if (args[0] === 'page') return args[1];
  return args[0];
}

/** Name after the `component` positional, shared by `add`, `move`, and `save`. */
export function componentTarget(args: string[]): string | undefined {
  const idx = args.indexOf('component');
  return idx !== -1 ? args[idx + 1] : undefined;
}
