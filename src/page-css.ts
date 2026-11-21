/**
 * Assembles a page's stylesheet from `global.css` and the page's component
 * styles, resolving design tokens first.
 *
 * Called by `build-pages.ts` and `commands-render.ts` (`css` and `--with-css`).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Component } from './types.js';
import { loadDesignTokens, resolveTokens } from './renderer.js';
import { assemblePageCSS } from './css.js';

/** `global.css` with design tokens substituted in. */
export function loadGlobalCSS(rootDir: string): string {
  const globalCSS = readFileSync(join(rootDir, 'global.css'), 'utf-8');
  return resolveTokens(globalCSS, loadDesignTokens(rootDir));
}

/** Scoped component CSS under the resolved global stylesheet. */
export function assembleComponentsCSS(rootDir: string, components: Component[]): string {
  return assemblePageCSS(components, loadGlobalCSS(rootDir));
}
