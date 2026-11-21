import { readFileSync, readdirSync } from 'node:fs';
import { basename } from 'node:path';
import { load } from 'js-yaml';
import type { Page, PageLayout } from './types.js';
import { EngineError } from './types.js';

const PAGE_SUFFIX = '.page.yaml';

/**
 * Natural-order comparator for page names: `slide-2` sorts before `slide-10`.
 *
 * Names are split into alternating non-digit / digit chunks. Digit chunks compare
 * by integer value; text chunks compare by UTF-16 code unit (no locale collation,
 * which would vary by machine). If one chunk list is a prefix of the other, the
 * shorter name sorts first.
 */
export function comparePageNames(a: string, b: string): number {
  const aChunks = a.match(/\d+|\D+/g) ?? [];
  const bChunks = b.match(/\d+|\D+/g) ?? [];
  const shared = Math.min(aChunks.length, bChunks.length);

  for (let i = 0; i < shared; i++) {
    const aChunk = aChunks[i];
    const bChunk = bChunks[i];
    if (/^\d/.test(aChunk) && /^\d/.test(bChunk)) {
      const diff = Number(aChunk) - Number(bChunk);
      if (diff !== 0) return diff < 0 ? -1 : 1;
    } else {
      if (aChunk < bChunk) return -1;
      if (aChunk > bChunk) return 1;
    }
  }

  // Numeric chunks can tie (leading zeros, or integers beyond 2^53), so fall
  // back to a raw string comparison: the order must be a total order, never
  // dependent on the filesystem's readdir sequence.
  return aChunks.length - bChunks.length || (a < b ? -1 : a > b ? 1 : 0);
}

/** Reads the optional `layout` map; throws PAGE_LAYOUT_INVALID on a wrong shape. */
function parseLayout(value: unknown, filePath: string): PageLayout | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new EngineError(`Page "layout" must be a map`, filePath, 'layout', 'ERROR', undefined, 'PAGE_LAYOUT_INVALID');
  }

  const raw = value as Record<string, unknown>;
  const layout: PageLayout = {};

  if (raw.wrapper !== undefined) {
    if (typeof raw.wrapper !== 'boolean') {
      throw new EngineError(`Page "layout.wrapper" must be a boolean`, filePath, 'layout.wrapper', 'ERROR', undefined, 'PAGE_LAYOUT_INVALID');
    }
    layout.wrapper = raw.wrapper;
  }

  if (raw.bodyClass !== undefined) {
    if (typeof raw.bodyClass !== 'string') {
      throw new EngineError(`Page "layout.bodyClass" must be a string`, filePath, 'layout.bodyClass', 'ERROR', undefined, 'PAGE_LAYOUT_INVALID');
    }
    layout.bodyClass = raw.bodyClass;
  }

  return layout;
}

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

  const layout = parseLayout(raw.layout, filePath);

  return {
    title: raw.title,
    description: raw.description,
    lang: typeof raw.lang === 'string' ? raw.lang : undefined,
    favicon: typeof raw.favicon === 'string' ? raw.favicon : undefined,
    viewport: typeof raw.viewport === 'string' ? raw.viewport : undefined,
    layout,
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
      .map((f) => basename(f, PAGE_SUFFIX))
      .sort(comparePageNames);
  } catch {
    return [];
  }
}
