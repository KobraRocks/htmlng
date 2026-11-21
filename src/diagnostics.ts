/**
 * Diagnostics policy shared by every command: de-duplication, page-file
 * attribution, and orphaned data-file warnings. The CLI owns I/O and calls
 * these functions; it does not re-implement the policy.
 */
import { EngineError, type EngineConfig } from './types.js';
import { findOrphanDataFiles } from './data-file.js';

/**
 * Drop exact duplicate diagnostics, keeping the first occurrence.
 *
 * Identity is code + file + field + message: the same component warning reached
 * through two pages is one finding, while an identical message attached to a
 * different file is a distinct finding.
 *
 * @param items diagnostics in report order (not mutated).
 * @returns a new array with exact duplicates removed.
 */
export function dedupeDiagnostics(items: EngineError[]): EngineError[] {
  const seen = new Set<string>();
  return items.filter((e) => {
    const key = `${e.code}|${e.file}|${e.field ?? ''}|${e.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Point a file-less diagnostic at the page that produced it.
 *
 * Structural page errors describe the assembled document and carry no file;
 * without attribution, two pages failing the same way would be collapsed by
 * de-duplication. A diagnostic that already names a file (a component or data
 * file) keeps it.
 */
function attributeToPage(error: EngineError, pageFile: string): EngineError {
  if (error.file) return error;
  return new EngineError(error.message, pageFile, error.field, error.level, error.help, error.code);
}

/**
 * Run one validation step, appending any EngineError it throws to `errors`
 * instead of aborting the run.
 *
 * @param errors collector; mutated by appending the thrown diagnostic.
 * @param fn validation step, run synchronously.
 * @param pageFile page file to attribute a file-less error to; omit when the
 *   step is not page-scoped.
 * @throws the original error when it is not an EngineError (a bug).
 */
export function collectDiagnostic(
  errors: EngineError[],
  fn: () => void,
  pageFile?: string,
): void {
  try {
    fn();
  } catch (e) {
    if (!(e instanceof EngineError)) throw e;
    errors.push(pageFile ? attributeToPage(e, pageFile) : e);
  }
}

/**
 * Warnings for data files under `data/<page>/` whose component the page no
 * longer lists. Rendering ignores such files, so re-adding the component later
 * would silently pick up stale content.
 *
 * @param rootDir project root.
 * @param config loaded engine config (supplies the data path).
 * @param pageName page whose data directory is scanned.
 * @param componentNames components currently listed on the page.
 * @returns one warning per orphan, sorted by component name; reads the data
 *   directory, returns nothing when it does not exist.
 */
export function orphanDataWarnings(
  rootDir: string,
  config: EngineConfig,
  pageName: string,
  componentNames: string[],
): EngineError[] {
  return findOrphanDataFiles(rootDir, config, pageName, componentNames).map(
    (orphan) => new EngineError(
      `Data file "${orphan.file}" has no matching component on page "${pageName}"`,
      orphan.file,
      undefined,
      'WARNING',
      `Delete the file, or add "${orphan.component}" back to the page's components.`,
      'DATA_FILE_ORPHAN',
    ),
  );
}
