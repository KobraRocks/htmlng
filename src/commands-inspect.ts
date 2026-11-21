/**
 * Read-only inspection commands that report on project state: `validate`,
 * `diff`, `list`, `context`, `schema`, and `explain`.
 *
 * Wired into the `handlers` map in `cli.ts`; all project state arrives through
 * the injected `CliContext`.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createTwoFilesPatch } from 'diff';
import { EngineError } from './types.js';
import type { CliContext } from './cli-context.js';
import { pageTarget } from './cli-args.js';
import { loadConfig } from './config.js';
import { renderPage, loadDesignTokens } from './renderer.js';
import { isStale } from './hasher.js';
import { parseComponent, findComponents } from './component.js';
import { parsePage, findPages } from './page.js';
import { loadData } from './data-file.js';
import { collectDiagnostic, dedupeDiagnostics } from './diagnostics.js';
import { validateComponent, validatePageStructure } from './validator.js';
import { listPresets } from './scaffold.js';
import { FORMAT_SPEC } from './format-spec.js';
import { ERROR_CATALOG, explainError, allErrorCodes } from './error-catalog.js';

export async function cmdValidate(ctx: CliContext, args: string[]): Promise<number> {
  ctx.log('Validating...');
  const errors: EngineError[] = [];
  const warnings: EngineError[] = [];
  const config = loadConfig(ctx.root);

  const pageFileOf = (page: string) => join(config.paths.pages, `${page}.page.yaml`);

  const target = args[0];
  let scope = 'all';
  if (target === 'page' && args[1]) {
    scope = `page:${args[1]}`;
    collectDiagnostic(errors, () => validatePageStructure(renderPage(ctx.root, args[1], false, warnings)), pageFileOf(args[1]));
  } else if (target === 'component' && args[1]) {
    scope = `component:${args[1]}`;
    const comp = parseComponent(join(ctx.root, config.paths.components, `${args[1]}.component.html`));
    collectDiagnostic(errors, () => { warnings.push(...validateComponent(comp)); });
  } else if (target) {
    ctx.emitJsonError('CLI_UNKNOWN_COMMAND', `Usage: htmlng validate [page <p>|component <c>]`, 'Run: htmlng --help');
    return 1;
  } else {
    // Validate every page and component, collecting all failures instead of stopping at the first
    for (const p of findPages(join(ctx.root, config.paths.pages))) {
      collectDiagnostic(errors, () => validatePageStructure(renderPage(ctx.root, p, false, warnings)), pageFileOf(p));
    }
    for (const c of findComponents(join(ctx.root, config.paths.components))) {
      collectDiagnostic(errors, () => { warnings.push(...validateComponent(parseComponent(join(ctx.root, config.paths.components, `${c}.component.html`)))); });
    }
  }

  // A component validated once per page and once per component would otherwise
  // be reported N+1 times, burying real findings.
  const dedupedErrors = dedupeDiagnostics(errors);
  const dedupedWarnings = dedupeDiagnostics(warnings);

  const ok = dedupedErrors.length === 0 && (!ctx.strict || dedupedWarnings.length === 0);

  if (ctx.jsonMode) {
    ctx.emit({
      ok,
      scope,
      errors: dedupedErrors.map((e) => e.toJSON()),
      warnings: dedupedWarnings.map((w) => w.toJSON()),
    });
    return ok ? 0 : 1;
  }

  for (const e of dedupedErrors) ctx.io.err(e.format() + '\n');
  for (const w of dedupedWarnings) ctx.io.err(w.format() + '\n');

  if (dedupedErrors.length > 0) {
    ctx.io.err(`Validation failed: ${dedupedErrors.length} error(s).\n`);
    return 1;
  }
  if (dedupedWarnings.length > 0) {
    ctx.io.out(`Validation passed with ${dedupedWarnings.length} warning(s).\n`);
    return ctx.strict ? 1 : 0;
  }
  ctx.io.out('Validation passed.\n');
  return 0;
}

export async function cmdDiff(ctx: CliContext, args: string[]): Promise<number> {
  const config = loadConfig(ctx.root);
  const buildDir = join(ctx.root, config.paths.build);
  const target = pageTarget(args);
  const pages = target ? [target] : findPages(join(ctx.root, config.paths.pages));

  const patches: Array<{ page: string; patch?: string; note?: string }> = [];
  let allUpToDate = true;

  for (const p of pages) {
    const newHtml = renderPage(ctx.root, p);
    const oldPath = join(buildDir, `${p}.html`);
    let oldHtml = '';
    try { oldHtml = readFileSync(oldPath, 'utf-8'); } catch { /* no old build */ }

    if (oldHtml && oldHtml !== newHtml) {
      allUpToDate = false;
      const patch = createTwoFilesPatch(`${p}.html`, `${p}.html`, oldHtml, newHtml);
      patches.push({ page: p, patch });
      if (!ctx.jsonMode) ctx.io.out(patch + '\n');
    } else if (!oldHtml) {
      allUpToDate = false;
      patches.push({ page: p, note: 'no previous build to diff against' });
      if (!ctx.jsonMode) ctx.io.out(`=== PAGE: ${p} === (no previous build to diff against)\n`);
    }
  }

  if (ctx.jsonMode) {
    ctx.emit({ ok: true, upToDate: allUpToDate, patches });
    return 0;
  }
  if (allUpToDate && pages.length > 0) {
    ctx.io.out('All pages up to date.\n');
  }
  return 0;
}

export async function cmdList(ctx: CliContext, args: string[]): Promise<number> {
  const config = loadConfig(ctx.root);
  const what = args[0];

  let kind = what;
  let items: string[] = [];

  if (what === 'presets') {
    items = listPresets(ctx.root);
  } else if (what === 'pages') {
    items = findPages(join(ctx.root, config.paths.pages));
  } else if (what === 'components') {
    items = findComponents(join(ctx.root, config.paths.components));
  } else if (what === 'data') {
    const page = args[1];
    if (!page) {
      ctx.emitJsonError('CLI_MISSING_NAME', 'Usage: htmlng list data <page>', 'Run: htmlng --help');
      return 1;
    }
    kind = `data:${page}`;
    try {
      items = readdirSync(join(ctx.root, config.paths.data, page))
        .filter((f) => f.endsWith('.yaml'))
        .map((f) => f.replace('.yaml', ''));
    } catch {
      items = [];
    }
  } else {
    ctx.emitJsonError('CLI_UNKNOWN_COMMAND', 'Usage: htmlng list pages|components|data <page>|presets', 'Run: htmlng --help');
    return 1;
  }

  if (ctx.jsonMode) ctx.emit({ ok: true, kind, items });
  else ctx.io.out(items.join('\n') + (items.length > 0 ? '\n' : '(none)\n'));
  return 0;
}

export async function cmdContext(ctx: CliContext, _args: string[]): Promise<number> {
  const config = loadConfig(ctx.root);
  const compDir = join(ctx.root, config.paths.components);

  const components = findComponents(compDir).map((name) => {
    try {
      const comp = parseComponent(join(compDir, `${name}.component.html`));
      return {
        name,
        schema: comp.schema,
        hasCSS: comp.css.trim().length > 0,
        templateBytes: comp.template.length,
      };
    } catch (e) {
      return { name, error: e instanceof EngineError ? e.toJSON() : { message: String(e) } };
    }
  });

  const pages = findPages(join(ctx.root, config.paths.pages)).map((name) => {
    const dataDir = join(ctx.root, config.paths.data, name);
    try {
      const page = parsePage(join(ctx.root, config.paths.pages, `${name}.page.yaml`));
      const comps = page.components.map((c) => {
        const dataPath = join(dataDir, `${c}.yaml`);
        const present = existsSync(dataPath);
        let dataShape: 'object' | 'array' | 'missing' = 'missing';
        let itemCount = 0;
        if (present) {
          const d = loadData(ctx.root, name, c);
          if (Array.isArray(d)) { dataShape = 'array'; itemCount = d.length; }
          else { dataShape = 'object'; itemCount = 1; }
        }
        return { name: c, dataShape, itemCount, dataFile: relative(ctx.root, dataPath) };
      });
      let stale = true;
      try { stale = isStale(ctx.root, name); } catch { /* unreadable */ }
      return { name, title: page.title, description: page.description, components: comps, stale };
    } catch (e) {
      return { name, error: e instanceof EngineError ? e.toJSON() : { message: String(e) } };
    }
  });

  ctx.emit({
    ok: true,
    root: ctx.root,
    project: config.project,
    config,
    tokens: loadDesignTokens(ctx.root),
    components,
    pages,
    presets: listPresets(ctx.root),
  });
  return 0;
}

export async function cmdSchema(ctx: CliContext, _args: string[]): Promise<number> {
  ctx.emit(FORMAT_SPEC);
  return 0;
}

export async function cmdExplain(ctx: CliContext, args: string[]): Promise<number> {
  const code = args[0];

  if (!code) {
    if (ctx.jsonMode) {
      ctx.emit({ ok: true, codes: allErrorCodes().map((c) => ({ code: c, ...ERROR_CATALOG[c] })) });
    } else {
      for (const c of allErrorCodes()) {
        ctx.io.out(`${c}\n  ${ERROR_CATALOG[c].summary}\n`);
      }
    }
    return 0;
  }

  const entry = explainError(code);
  if (!entry) {
    ctx.emitJsonError('CLI_UNKNOWN_ERROR_CODE', `Unknown error code: ${code}`, 'Run "htmlng explain" to list every code.');
    return 1;
  }
  if (ctx.jsonMode) ctx.emit({ ok: true, code, ...entry });
  else ctx.io.out(`${code}\n  ${entry.summary}\n  Fix: ${entry.fix}\n`);
  return 0;
}
