import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import type { EngineConfig, PlaceholderValue } from './types.js';
import { EngineError } from './types.js';
import { loadConfig } from './config.js';

const DATA_SUFFIX = '.yaml';

/**
 * Path of the data file for one component on one page, rooted at `rootDir`.
 * The only place that knows how a data file is addressed.
 */
export function dataFilePath(
  rootDir: string,
  config: EngineConfig,
  pageName: string,
  componentName: string,
): string {
  return join(rootDir, config.paths.data, pageName, `${componentName}${DATA_SUFFIX}`);
}

/**
 * Load data/<pageName>/<componentName>.yaml (respecting config.paths.data).
 *
 * Returns an object (Record) when the YAML root is a map — one component instance.
 * Returns an array when the YAML root is a sequence — N component instances,
 * each rendered as a separate section with indexed IDs.
 * Returns empty object if file or directory doesn't exist.
 */
export function loadData(
  rootDir: string,
  pageName: string,
  componentName: string,
): Record<string, PlaceholderValue> | Record<string, PlaceholderValue>[] {
  const config = loadConfig(rootDir);
  const filePath = dataFilePath(rootDir, config, pageName, componentName);

  try {
    const content = readFileSync(filePath, 'utf-8');
    const parsed = load(content);
    if (parsed === null || parsed === undefined) return {};

    if (Array.isArray(parsed)) {
      // Array root — repeated instances of the same component
      if (parsed.length === 0) return [];
      for (let i = 0; i < parsed.length; i++) {
        const item = parsed[i];
        if (typeof item !== 'object' || item === null || Array.isArray(item)) {
          throw new EngineError(
            `Array element [${i}] must be an object with placeholder keys, got ${Array.isArray(item) ? 'array' : typeof item}`,
            filePath,
            undefined,
            'ERROR',
            undefined,
            'DATA_ARRAY_ITEM_INVALID',
          );
        }
      }
      return parsed as Record<string, PlaceholderValue>[];
    }

    if (typeof parsed !== 'object') {
      throw new EngineError(
        `Data file must contain a YAML object or array, got ${typeof parsed}`,
        filePath,
        undefined,
        'ERROR',
        undefined,
        'DATA_ROOT_INVALID',
      );
    }
    return parsed as Record<string, PlaceholderValue>;
  } catch (e) {
    if (e instanceof EngineError) throw e;
    // File or directory doesn't exist — return empty object
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new EngineError(
      `Failed to parse data file: ${(e as Error).message}`,
      filePath,
      undefined,
      'ERROR',
      undefined,
      'DATA_PARSE',
    );
  }
}

/** A data file whose component the page no longer lists. */
export interface OrphanDataFile {
  /** File base name without the extension — the component it was written for. */
  component: string;
  /** Path of the orphaned data file, rooted at `rootDir`. */
  file: string;
}

/**
 * Data files under data/<pageName>/ whose component is not referenced by the page.
 * Locates them only; `diagnostics.ts` turns each into a DATA_FILE_ORPHAN warning.
 *
 * Accepts the caller's already-loaded config and returns absolute file paths,
 * so path layout stays owned by this module. Sorted deterministically by
 * component name; `[]` when the page's data directory does not exist.
 */
export function findOrphanDataFiles(
  rootDir: string,
  config: EngineConfig,
  pageName: string,
  componentNames: string[],
): OrphanDataFile[] {
  const dir = join(rootDir, config.paths.data, pageName);

  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return [];
  }

  const referenced = new Set(componentNames);
  return files
    .filter((f) => f.endsWith(DATA_SUFFIX))
    .map((f) => f.slice(0, -DATA_SUFFIX.length))
    .filter((name) => !referenced.has(name))
    .sort()
    .map((component) => ({ component, file: dataFilePath(rootDir, config, pageName, component) }));
}
