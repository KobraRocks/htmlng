/**
 * CLI entry point: parse argv, build the invocation context, dispatch to a
 * command module, and map the result to an exit code.
 *
 * Called by `index.ts` (the binary entry point) and by the CLI tests.
 */
import { EngineError } from './types.js';
import { loadConfig } from './config.js';
import { parseArgs, type ParsedArgs } from './cli-args.js';
import { createCliContext, type Command, type Io } from './cli-context.js';
import { cmdInit, cmdCreate, cmdAdd, cmdMove, cmdSave } from './commands-authoring.js';
import { cmdValidate, cmdDiff, cmdList, cmdContext, cmdSchema, cmdExplain } from './commands-inspect.js';
import { cmdRender, cmdPreview, cmdCSS } from './commands-render.js';
import { cmdBuild, cmdWatch } from './commands-build.js';
import { cmdServe } from './commands-serve.js';

const defaultIo: Io = {
  out: (s) => process.stdout.write(s),
  err: (s) => process.stderr.write(s),
};

const handlers: Record<string, Command> = {
  init:    cmdInit,
  create:  cmdCreate,
  render:  cmdRender,
  preview: cmdPreview,
  validate: cmdValidate,
  build:   cmdBuild,
  diff:    cmdDiff,
  watch:   cmdWatch,
  save:    cmdSave,
  add:     cmdAdd,
  list:    cmdList,
  serve:   cmdServe,
  move:    cmdMove,
  css:     cmdCSS,
  context: cmdContext,
  schema:  cmdSchema,
  explain: cmdExplain,
};

/** Canonical CLI command names, used by help output and docs-conformance tests. */
export const COMMAND_NAMES: string[] = Object.keys(handlers);

export const HELP = `HTML Engine — deterministic component-based HTML generator

Usage: htmlng <command> [args]

Commands:
  init [--name <name>]           Initialize a new project
  create component <name>        Scaffold a new component
  create page <name>             Scaffold a new page
  create data <c> --page <p>     Scaffold a data file
  render component <c> --page <p> Render component with page data to stdout
  render component <c> --all     Render component with all pages' data
  render page <p> [--compact]    Render full page to stdout
  preview component <c>          Preview component with sample data
  validate [page <p>|component <c>]  Validate all or a specific target
  build [page <p>]               Build pages to build/ directory (wipes build/ when building all)
  diff [page <p>]                Show unified diff vs last build
  watch                          Watch files, rebuild and write on change
  add component <c> --page <p>   Add component to page
  move component <c> --page <p> --before|--after <other>  Reorder component
  save component <c> --as-preset <name>  Save component as reusable preset
  list pages|components|data [<p>]  List resources
  list presets                   List available presets
  serve [--port <n>] [--watch]  Start dev server on build/ directory
  css <page>                    Output assembled CSS for a page (global + all component styles)
  context                       Print the whole project map as JSON (pages, components, data, tokens)
  schema                        Print the machine-readable file-format spec as JSON
  explain [<code>]              Explain an error code (lists all codes when omitted)

Flags:
  --verbose    Enable debug logging
  --strict     Treat warnings as errors (also honored from validation.strict in config)
  --json       Machine-readable JSON output (validate, build, render, list, preview, ...)
  --compact    Render without annotation header (render page only)
  --help       Show this help

Page arguments accept both "build page <p>" and "build <p>".

Exit codes:
  0  success
  1  any failure (validation error, missing file, usage error)

Machine-readable errors carry a stable "code": run "htmlng explain <code>".
`;

export async function run(argv: string[], sink: Io = defaultIo): Promise<number> {
  const root = process.cwd();

  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv);
  } catch (e) {
    if (e instanceof EngineError) {
      // Parsing failed before the real context exists; the only state the
      // reporter needs is the raw `--json` intent.
      const parseFlags = new Map<string, string | true>();
      if (argv.includes('--json')) parseFlags.set('--json', true);
      createCliContext({
        root,
        io: sink,
        flags: parseFlags,
        strict: false,
      }).emitError(e);
      return 1;
    }
    throw e;
  }

  const flags = parsed.flags;
  let strict = flags.has('--strict');

  // Config-level strict is additive; ignore when there is no config yet (e.g. `init`)
  try { if (loadConfig(root).validation.strict) strict = true; } catch { /* no config */ }

  const ctx = createCliContext({
    root,
    io: sink,
    flags,
    strict,
  });

  if (flags.has('--help') || argv.length === 0) {
    sink.out(HELP);
    return 0;
  }

  const handler = handlers[parsed.command];
  if (!handler) {
    ctx.emitJsonError('CLI_UNKNOWN_COMMAND', `Unknown command: ${parsed.command}`, 'Run: htmlng --help');
    return 1;
  }

  try {
    return (await handler(ctx, parsed.args)) ?? 0;
  } catch (e) {
    if (e instanceof EngineError) {
      ctx.emitError(e);
      if (e.level === 'WARNING' && !strict) return 0;
      return 1;
    }
    sink.err(`FATAL: ${(e as Error).message}\n`);
    return 1;
  }
}
