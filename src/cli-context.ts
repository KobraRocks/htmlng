/**
 * Per-invocation CLI context derived from the project root, parsed flags, and
 * injected output sinks: flag lookups, JSON emission, error reporting, and the
 * warning policy every command module shares.
 *
 * Built by `run` in `cli.ts`; command modules receive this context instead of
 * reading module globals, so sequential invocations cannot leak state.
 */
import { dedupeDiagnostics } from './diagnostics.js';
import type { ErrorCode } from './error-catalog.js';
import { EngineError, type ErrorJson } from './types.js';

/** Output sinks injected by `run`; tests pass a capture instead of process streams. */
export interface Io {
  out(s: string): void;
  err(s: string): void;
}

/** Version of the `--json` output contract, included in every `{ ok: ... }` payload. */
export const JSON_SCHEMA_VERSION = 1;

/** The state and reporting helpers a command handler receives. */
export interface CliContext {
  readonly root: string;
  readonly io: Io;
  readonly jsonMode: boolean;
  readonly strict: boolean;
  /** Value of a `--flag <value>`, or null when the flag is absent or boolean. */
  flag(name: string): string | null;
  has(name: string): boolean;
  log(...args: unknown[]): void;
  emit(value: unknown): void;
  emitError(e: EngineError): void;
  emitJsonError(code: ErrorCode, message: string, help?: string): void;
  /** Exit code a warning list implies: 1 under strict mode, else 0. */
  warningsExitCode(warnings: EngineError[]): number;
  /** Print de-duplicated warnings and return their strict-mode exit code. */
  reportWarnings(warnings: EngineError[]): number;
}

/** A command handler: receives the invocation context plus its positional args. */
export type Command = (ctx: CliContext, args: string[]) => Promise<number | void>;

export interface ContextOptions {
  root: string;
  io: Io;
  flags: Map<string, string | true>;
  /** `--strict` plus config-level `validation.strict`. */
  strict: boolean;
}

export function createCliContext(options: ContextOptions): CliContext {
  const { root, io, flags, strict } = options;
  const jsonMode = flags.has('--json');
  const verbose = flags.has('--verbose');

  /**
   * Emit a machine-readable JSON value on stdout. Payloads that carry an `ok`
   * field (the command-result contract) are stamped with `schemaVersion`.
   */
  function emit(value: unknown): void {
    const payload =
      value !== null && typeof value === 'object' && 'ok' in (value as Record<string, unknown>)
        ? { schemaVersion: JSON_SCHEMA_VERSION, ...(value as Record<string, unknown>) }
        : value;
    io.out(JSON.stringify(payload, null, 2) + '\n');
  }

  function emitError(e: EngineError): void {
    if (jsonMode) emit({ ok: false, errors: [e.toJSON()] });
    else io.err(e.format() + '\n');
  }

  function emitJsonError(code: ErrorCode, message: string, help?: string): void {
    if (jsonMode) {
      const err: ErrorJson = { code, level: 'ERROR', file: '', message, help };
      emit({ ok: false, errors: [err] });
    } else {
      io.err(`ERROR []: ${message}\n${help ? `  ${help}\n` : ''}`);
    }
  }

  function warningsExitCode(warnings: EngineError[]): number {
    return strict && warnings.length > 0 ? 1 : 0;
  }

  /**
   * Print collected warnings; return 1 when `--strict`/config strict is active.
   * Long-running commands (`watch`, `serve --watch`) report through this helper
   * but ignore the return, so a warning does not turn into an exit.
   */
  function reportWarnings(warnings: EngineError[]): number {
    const unique = dedupeDiagnostics(warnings);
    for (const w of unique) io.err(w.format() + '\n');
    return warningsExitCode(unique);
  }

  return {
    root,
    io,
    jsonMode,
    strict,
    flag: (name) => {
      const value = flags.get(name);
      return typeof value === 'string' ? value : null;
    },
    has: (name) => flags.has(name),
    log: (...args) => { if (verbose) io.err(`[debug] ${args.join(' ')}\n`); },
    emit,
    emitError,
    emitJsonError,
    warningsExitCode,
    reportWarnings,
  };
}
