import { join } from 'node:path';
import { loadConfig } from './config.js';
import { findPages, parsePage } from './page.js';

/**
 * Given a changed file path, return all page names that need re-rendering.
 */
export function affectedPages(rootDir: string, changedFile: string): string[] {
  const config = loadConfig(rootDir);

  // global.css → all pages
  if (changedFile === 'global.css' || changedFile.endsWith('/global.css')) {
    return findPages(join(rootDir, config.paths.pages));
  }

  // Component file → all pages referencing it
  const compMatch = changedFile.match(/components\/(.+)\.component\.html$/);
  if (compMatch) {
    const compName = compMatch[1];
    const pages = findPages(join(rootDir, config.paths.pages));
    const affected: string[] = [];
    for (const pageName of pages) {
      const page = parsePage(join(rootDir, config.paths.pages, `${pageName}.page.yaml`));
      if (page.components.includes(compName)) {
        affected.push(pageName);
      }
    }
    return affected;
  }

  // Data file → only the page it belongs to
  const dataMatch = changedFile.match(/data\/([^/]+)\/.+\.yaml$/);
  if (dataMatch) {
    return [dataMatch[1]];
  }

  // Page YAML → only that page
  const pageMatch = changedFile.match(/pages\/(.+)\.page\.yaml$/);
  if (pageMatch) {
    return [pageMatch[1]];
  }

  return [];
}
