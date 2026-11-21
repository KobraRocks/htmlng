/**
 * Reads and writes `.engine-cache.json` source hashes for staleness and
 * changed-file tracking.
 *
 * Called by the CLI.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { CacheManifest } from './types.js';
import { loadConfig } from './config.js';
import { parsePage } from './page.js';

const CACHE_FILE = '.engine-cache.json';

function cachePath(rootDir: string): string {
  return join(rootDir, CACHE_FILE);
}

function loadCache(rootDir: string): CacheManifest {
  const p = cachePath(rootDir);
  if (!existsSync(p)) return { version: 1, pages: {} };
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as CacheManifest;
  } catch {
    return { version: 1, pages: {} };
  }
}

function saveCache(rootDir: string, cache: CacheManifest): void {
  writeFileSync(cachePath(rootDir), JSON.stringify(cache, null, 2));
}

function hashFile(path: string): string | null {
  try {
    const content = readFileSync(path, 'utf-8');
    return createHash('sha256').update(content).digest('hex');
  } catch {
    return null;
  }
}

export function isStale(rootDir: string, pageName: string): boolean {
  const cache = loadCache(rootDir);
  const entry = cache.pages[pageName];
  if (!entry) return true;

  // Check if component list changed
  const config = loadConfig(rootDir);
  const page = parsePage(join(rootDir, config.paths.pages, `${pageName}.page.yaml`));

  // Hash all source files
  const sources = getSourceFiles(rootDir, pageName, page);

  for (const [file, expectedHash] of Object.entries(entry.sources)) {
    const current = hashFile(join(rootDir, file));
    if (current !== expectedHash) return true;
  }

  // Check for new files
  for (const file of sources) {
    if (!(file in entry.sources)) return true;
  }

  return false;
}

export function getChangedSources(rootDir: string, pageName: string): string[] {
  const cache = loadCache(rootDir);
  const entry = cache.pages[pageName];
  if (!entry) return [];

  const config = loadConfig(rootDir);
  const page = parsePage(join(rootDir, config.paths.pages, `${pageName}.page.yaml`));
  const sources = getSourceFiles(rootDir, pageName, page);

  const changed: string[] = [];
  for (const file of sources) {
    const current = hashFile(join(rootDir, file));
    if (current !== entry.sources[file]) changed.push(file);
  }
  return changed;
}

export function updateCache(rootDir: string, pageName: string, _html: string): void {
  const cache = loadCache(rootDir);
  const config = loadConfig(rootDir);
  const page = parsePage(join(rootDir, config.paths.pages, `${pageName}.page.yaml`));
  const sources = getSourceFiles(rootDir, pageName, page);

  const sourceHashes: Record<string, string> = {};
  for (const file of sources) {
    const h = hashFile(join(rootDir, file));
    if (h) sourceHashes[file] = h;
  }

  const pageHash = createHash('sha256')
    .update(JSON.stringify(sourceHashes))
    .digest('hex');

  cache.pages[pageName] = {
    hash: pageHash,
    builtAt: new Date().toISOString(),
    sources: sourceHashes,
  };

  saveCache(rootDir, cache);
}

function getSourceFiles(rootDir: string, pageName: string, page: { components: string[] }): string[] {
  const config = loadConfig(rootDir);
  const files: string[] = ['global.css', 'design-tokens.yaml', 'engine.config.yaml'];
  files.push(join(config.paths.pages, `${pageName}.page.yaml`));

  for (const compName of page.components) {
    files.push(join(config.paths.components, `${compName}.component.html`));
    files.push(join(config.paths.data, pageName, `${compName}.yaml`));
  }

  return files;
}
