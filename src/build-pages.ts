/**
 * Build orchestration: render pages, write `build/` (HTML, CSS, assets), and
 * refresh the staleness cache.
 *
 * Called by the `build`, `watch`, and `serve` command modules; callers own
 * warning output so long-running loops can decide whether a warning exits.
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { EngineError } from './types.js';
import { loadConfig } from './config.js';
import { renderPage } from './renderer.js';
import { assembleComponentsCSS } from './page-css.js';
import { updateCache } from './hasher.js';
import { copyAssets } from './copier.js';
import { parseComponent } from './component.js';
import { parsePage, findPages } from './page.js';
import { dedupeDiagnostics } from './diagnostics.js';

export interface BuildOutcome {
  pages: string[];
  warnings: EngineError[];
}

/**
 * Render + write pages, and refresh the cache. Single source of truth shared by
 * `build`, `watch`, and `serve --watch`.
 *
 * With no explicit page list, `build/` is wiped first so deleted/renamed pages
 * cannot linger (spec C14). Targeted builds leave other pages untouched.
 */
export function buildPages(root: string, pageNames?: string[]): BuildOutcome {
  const config = loadConfig(root);
  const buildDir = join(root, config.paths.build);
  const targeted = pageNames !== undefined;

  if (!targeted) rmSync(buildDir, { recursive: true, force: true });
  mkdirSync(buildDir, { recursive: true });
  if (!config.build.inlineCSS) mkdirSync(join(buildDir, 'css'), { recursive: true });

  const pages = pageNames ?? findPages(join(root, config.paths.pages));
  const warnings: EngineError[] = [];

  for (const p of pages) {
    const html = renderPage(root, p, config.build.inlineCSS, warnings);
    writeFileSync(join(buildDir, `${p}.html`), html);

    if (!config.build.inlineCSS) {
      const page = parsePage(join(root, config.paths.pages, `${p}.page.yaml`));
      const allComps = page.components.map(n =>
        parseComponent(join(root, config.paths.components, `${n}.component.html`))
      );
      writeFileSync(join(buildDir, 'css', `${p}.css`), assembleComponentsCSS(root, allComps));
    }

    updateCache(root, p, html);
  }

  copyAssets(root);
  // A component shared by several pages is validated once per page; report each
  // distinct warning once.
  return { pages, warnings: dedupeDiagnostics(warnings) };
}
