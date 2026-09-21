import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import type { PlaceholderValue } from './types.js';
import { EngineError } from './types.js';
import { loadConfig } from './config.js';

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
