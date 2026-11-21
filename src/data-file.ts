import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import type { PlaceholderValue } from './types.js';
import { EngineError } from './types.js';
import { loadConfig } from './config.js';

const DATA_SUFFIX = '.yaml';

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
  const filePath = join(rootDir, config.paths.data, pageName, `${componentName}.yaml`);

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

/**
 * Data files under data/<pageName>/ whose component is not referenced by the page.
 * Used by `validate` to report DATA_FILE_ORPHAN (a stale file that would
 * silently be picked up if the component were re-added).
 *
 * Returns the component names (file base names without the extension) sorted
 * deterministically; `[]` when the page's data directory does not exist.
 */
export function findOrphanDataComponents(rootDir: string, pageName: string, componentNames: string[]): string[] {
  const config = loadConfig(rootDir);
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
    .sort();
}
