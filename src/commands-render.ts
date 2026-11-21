/**
 * Render-to-stdout commands: `render` (component or page), `preview`, and `css`.
 *
 * Wired into the `handlers` map in `cli.ts`; all project state arrives through
 * the injected `CliContext`.
 */
import { join } from 'node:path';
import { EngineError, type ErrorJson } from './types.js';
import type { CliContext } from './cli-context.js';
import { requireName } from './cli-args.js';
import { loadConfig } from './config.js';
import { parseComponent } from './component.js';
import { parsePage, findPages } from './page.js';
import { loadData } from './data-file.js';
import { renderPage, renderComponent, previewComponent } from './renderer.js';
import { assembleComponentsCSS } from './page-css.js';
import { getChangedSources, isStale } from './hasher.js';
import { escapeAttr } from './escape.js';

export async function cmdRender(ctx: CliContext, args: string[]): Promise<number> {
  const withCSS = ctx.has('--with-css');
  const sub = args[0];

  if (sub === 'component') {
    const name = requireName(args[1], 'component', 'htmlng render component <name> --page <page>');
    const warnings: EngineError[] = [];

    if (ctx.has('--all')) {
      const config = loadConfig(ctx.root);
      const pages = findPages(join(ctx.root, config.paths.pages));
      const rendered: Array<{ page: string; html?: string; error?: ErrorJson }> = [];
      for (const p of pages) {
        try {
          const data = loadData(ctx.root, p, name);
          const isEmpty = Array.isArray(data) ? data.length === 0 : Object.keys(data).length === 0;
          if (isEmpty) continue;
          const html = renderComponent(ctx.root, name, p, warnings);
          if (!ctx.jsonMode) ctx.io.out(`=== COMPONENT: ${name}\n=== PAGE: ${p}\n=== STATUS: rendered\n\n${html}\n`);
          rendered.push({ page: p, html });
        } catch (e) {
          if (e instanceof EngineError) {
            if (!ctx.jsonMode) ctx.io.out(`=== COMPONENT: ${name}\n=== PAGE: ${p}\n=== STATUS: error\n${e.format()}\n\n`);
            rendered.push({ page: p, error: e.toJSON() });
          } else throw e;
        }
      }
      if (ctx.jsonMode) ctx.emit({ ok: true, component: name, results: rendered, warnings: warnings.map((w) => w.toJSON()) });
      return ctx.reportWarnings(warnings);
    }

    const page = ctx.flag('--page');
    if (!page) {
      ctx.emitJsonError('CLI_FLAG_MISSING', 'Error: --page <page> is required (or use --all)', 'Run: htmlng --help');
      return 1;
    }
    const html = renderComponent(ctx.root, name, page, warnings);

    if (withCSS && !ctx.jsonMode) {
      ctx.io.out(wrapWithCSS(ctx.root, name, html));
      return ctx.reportWarnings(warnings);
    }

    const changed = getChangedSources(ctx.root, page);

    if (ctx.jsonMode) {
      ctx.emit({
        ok: true,
        component: name,
        page,
        // A render always produces fresh output; `changed` reports cache drift.
        status: 'rendered',
        changed,
        withCSS,
        html: withCSS ? wrapWithCSS(ctx.root, name, html) : html,
        warnings: warnings.map((w) => w.toJSON()),
      });
    } else {
      // Read-only render: always fresh, so never claim "cached" (issue 15.5).
      ctx.io.out(`=== COMPONENT: ${name}\n=== PAGE: ${page}\n=== STATUS: rendered\n\n${html}\n`);
    }
    return ctx.reportWarnings(warnings);
  }

  if (sub === 'page') {
    const name = requireName(args[1], 'page', 'htmlng render page <name> [--compact]');
    ctx.log(`Rendering page: ${name}`);
    const config = loadConfig(ctx.root);
    const warnings: EngineError[] = [];
    const html = renderPage(ctx.root, name, config.build.inlineCSS, warnings);
    const stale = isStale(ctx.root, name);
    const changed = getChangedSources(ctx.root, name);
    const page = parsePage(join(ctx.root, config.paths.pages, `${name}.page.yaml`));

    if (ctx.jsonMode) {
      ctx.emit({
        ok: true,
        page: name,
        status: 'rendered',
        changed,
        components: page.components,
        css: config.build.inlineCSS ? 'inline' : `css/${name}.css`,
        html,
        warnings: warnings.map((w) => w.toJSON()),
      });
      return ctx.reportWarnings(warnings);
    }

    if (!ctx.has('--compact')) {
      const cssRef = config.build.inlineCSS
        ? `inline <style> (global + ${page.components.length} components)`
        : `css/${name}.css (global + ${page.components.length} components)`;
      ctx.io.out(
        `=== PAGE: ${name}\n=== SOURCES: ${stale ? `changed: ${changed.join(', ') || 'unknown'}` : 'unchanged since last build'}\n` +
        `=== COMPONENTS: ${page.components.join(', ')}\n` +
        `=== CSS: ${cssRef}\n\n`
      );
    }
    ctx.io.out(html + '\n');
    return ctx.reportWarnings(warnings);
  }

  ctx.emitJsonError('CLI_UNKNOWN_COMMAND', 'Usage: htmlng render component|page ...', 'Run: htmlng --help');
  return 1;
}

export async function cmdPreview(ctx: CliContext, args: string[]): Promise<number> {
  const name = requireName(args[1], 'component', 'htmlng preview component <name> [--with-css]');
  const withCSS = ctx.has('--with-css');
  const html = previewComponent(ctx.root, name);
  if (ctx.jsonMode) {
    ctx.emit({ ok: true, component: name, withCSS, html: withCSS ? wrapWithCSS(ctx.root, name, html) : html });
    return 0;
  }
  if (withCSS) {
    ctx.io.out(wrapWithCSS(ctx.root, name, html));
  } else {
    ctx.io.out(`=== COMPONENT: ${name} (preview)\n=== STATUS: sample data\n\n${html}\n`);
  }
  return 0;
}

export async function cmdCSS(ctx: CliContext, args: string[]): Promise<number> {
  const pageName = args[0];
  if (!pageName) {
    ctx.emitJsonError('CLI_MISSING_NAME', 'Usage: htmlng css <page>');
    return 1;
  }

  const config = loadConfig(ctx.root);
  const page = parsePage(join(ctx.root, config.paths.pages, `${pageName}.page.yaml`));

  const allComps = page.components.map(n =>
    parseComponent(join(ctx.root, config.paths.components, `${n}.component.html`))
  );
  const assembled = assembleComponentsCSS(ctx.root, allComps);

  if (ctx.jsonMode) {
    ctx.emit({ ok: true, page: pageName, components: page.components, css: assembled });
    return 0;
  }

  ctx.io.out(`=== PAGE: ${pageName} ===\n`);
  ctx.io.out(`=== COMPONENTS: ${page.components.join(', ')} ===\n`);
  ctx.io.out(`=== Global CSS + ${page.components.length} component CSS blocks ===\n\n`);
  ctx.io.out(assembled + '\n');
  return 0;
}

function wrapWithCSS(rootDir: string, componentName: string, innerHTML: string): string {
  const config = loadConfig(rootDir);
  const comp = parseComponent(join(rootDir, config.paths.components, `${componentName}.component.html`));
  const scopedCSS = assembleComponentsCSS(rootDir, [comp]);

  return `<!DOCTYPE html>\n<html>\n<head>\n<meta charset="UTF-8">\n<style>\n${scopedCSS}\n</style>\n</head>\n<body>\n  <div class="${escapeAttr(componentName)}">\n${indent(innerHTML, 4)}\n  </div>\n</body>\n</html>`;
}

function indent(s: string, n: number): string { const p = ' '.repeat(n); return s.split('\n').map(l => p + l).join('\n'); }
