import { readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { load } from 'js-yaml';
import type { Page } from './types.js';
import { EngineError } from './types.js';

const PAGE_SUFFIX = '.page.yaml';

export function parsePage(filePath: string): Page {
  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    throw new EngineError(`Page file not found: ${filePath}`, filePath, undefined, 'ERROR', undefined, 'PAGE_NOT_FOUND');
  }

  let raw: Record<string, unknown>;
  try {
    raw = (load(content) as Record<string, unknown>) ?? {};
  } catch (e) {
    throw new EngineError(`Failed to parse page YAML: ${(e as Error).message}`, filePath, undefined, 'ERROR', undefined, 'PAGE_PARSE');
  }

  if (typeof raw.title !== 'string') {
    throw new EngineError(`Page must have a "title" field (string)`, filePath, 'title', 'ERROR', undefined, 'PAGE_TITLE_INVALID');
  }
  if (typeof raw.description !== 'string') {
    throw new EngineError(`Page must have a "description" field (string)`, filePath, 'description', 'ERROR', undefined, 'PAGE_DESCRIPTION_INVALID');
  }
  if (!Array.isArray(raw.components)) {
    throw new EngineError(`Page must have a "components" field (array)`, filePath, 'components', 'ERROR', undefined, 'PAGE_COMPONENTS_INVALID');
  }

  return {
    title: raw.title,
    description: raw.description,
    lang: typeof raw.lang === 'string' ? raw.lang : undefined,
    favicon: typeof raw.favicon === 'string' ? raw.favicon : undefined,
    viewport: typeof raw.viewport === 'string' ? raw.viewport : undefined,
    head: raw.head as Page['head'] | undefined,
    scripts: raw.scripts as Page['scripts'] | undefined,
    components: raw.components as string[],
  };
}

export function findPages(dir: string): string[] {
  try {
    const files = readdirSync(dir);
    return files
      .filter((f) => f.endsWith(PAGE_SUFFIX))
      .map((f) => basename(f, PAGE_SUFFIX));
  } catch {
    return [];
  }
}
