import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import type { PlaceholderValue } from './types.js';
import { EngineError } from './types.js';

/**
 * Load data/<pageName>/<componentName>.yaml.
 * Returns empty object if file or directory doesn't exist.
 */
export function loadData(
  rootDir: string,
  pageName: string,
  componentName: string,
): Record<string, PlaceholderValue> {
  const filePath = join(rootDir, 'data', pageName, `${componentName}.yaml`);

  try {
    const content = readFileSync(filePath, 'utf-8');
    const parsed = load(content);
    if (parsed === null || parsed === undefined) return {};
    if (typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new EngineError(
        `Data file must contain a YAML object (key-value pairs), got ${Array.isArray(parsed) ? 'array' : typeof parsed}`,
        filePath,
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
    );
  }
}
