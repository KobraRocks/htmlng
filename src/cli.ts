import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { createTwoFilesPatch } from 'diff';
import { load, dump } from 'js-yaml';
import { EngineError } from './types.js';
import { loadConfig } from './config.js';
import { renderPage, renderComponent, previewComponent, loadDesignTokens, resolveTokens } from './renderer.js';
import { assemblePageCSS } from './css.js';
import { isStale, getChangedSources, updateCache } from './hasher.js';
import { affectedPages } from './propagation.js';
import { copyAssets } from './copier.js';
import {
  initProject,
  scaffoldComponent,
  scaffoldPage,
  scaffoldData,
  scaffoldPresetComponent,
  savePreset,
  listPresets,
} from './scaffold.js';
import { validateComponent, validatePageStructure } from './validator.js';
import { parseComponent, findComponents } from './component.js';
import { parsePage, findPages } from './page.js';
import { loadData } from './data-file.js';

let ROOT = process.cwd();
let verbose = false;
let strict = false;
let flags = new Map<string, string | true>();

// ── Output sinks ────────────────────────────────────────
// Handlers never touch process streams directly: `run` injects a sink so the
// CLI is testable and every handler reports failure through a return code.

export interface Io {
  out(s: string): void;
  err(s: string): void;
}

const defaultIo: Io = {
  out: (s) => process.stdout.write(s),
  err: (s) => process.stderr.write(s),
};

let io: Io = defaultIo;

function log(...args: unknown[]) { if (verbose) io.err(`[debug] ${args.join(' ')}\n`); }

// ── Argument parsing ────────────────────────────────────

/** Flags that consume the following token as a value. */
const VALUE_FLAGS = new Set([
  '--page', '--name', '--port', '--before', '--after', '--preset', '--as-preset',
]);

/** Flags that stand alone. */
const BOOL_FLAGS = new Set([
  '--all', '--compact', '--with-css', '--watch', '--verbose', '--strict', '--help',
]);

interface ParsedArgs {
  command: string;
  args: string[];
  flags: Map<string, string | true>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const parsed = new Map<string, string | true>();

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];

    if (token === '-h') { parsed.set('--help', true); continue; }
    if (token === '-' || !token.startsWith('-')) { positionals.push(token); continue; }

    if (VALUE_FLAGS.has(token)) {
      const value = argv[i + 1];
      if (value === undefined) {
        throw new EngineError(`Flag ${token} requires a value`, '', undefined, 'ERROR', 'Run: htmlng --help');
      }
      parsed.set(token, value);
      i++;
      continue;
    }

    if (BOOL_FLAGS.has(token)) { parsed.set(token, true); continue; }

    throw new EngineError(`Unknown flag: ${token}`, '', undefined, 'ERROR', 'Run: htmlng --help');
  }

  return { command: positionals[0] ?? '', args: positionals.slice(1), flags: parsed };
}

function flag(name: string): string | null {
  const value = flags.get(name);
  return typeof value === 'string' ? value : null;
}

function has(name: string): boolean {
  return flags.has(name);
}

interface Handler {
  (args: string[]): Promise<number | void>;
}

const handlers: Record<string, Handler> = {
  init:    cmdInit,
  create:  cmdCreate,
  render:  cmdRender,
  preview: cmdPreview,
  validate: cmdValidate,
  build:   cmdBuild,
  diff:    cmdDiff,
  watch:   cmdWatch,
  save:    cmdSave,
  add:     cmdAdd,
  list:    cmdList,
  serve:   cmdServe,
  move:    cmdMove,
  css:     cmdCSS,
};

export const HELP = `HTML Engine — deterministic component-based HTML generator

Usage: htmlng <command> [args]

Commands:
  init [--name <name>]           Initialize a new project
  create component <name>        Scaffold a new component
  create page <name>             Scaffold a new page
  create data <c> --page <p>     Scaffold a data file
  render component <c> --page <p> Render component with page data to stdout
  render component <c> --all     Render component with all pages' data
  render page <p> [--compact]    Render full page to stdout
  preview component <c>          Preview component with sample data
  validate [page <p>|component <c>]  Validate all or a specific target
  build [page <p>]               Build pages to build/ directory (wipes build/ when building all)
  diff [page <p>]                Show unified diff vs last build
  watch                          Watch files, rebuild and write on change
  add component <c> --page <p>   Add component to page
  move component <c> --page <p> --before|--after <other>  Reorder component
  save component <c> --as-preset <name>  Save component as reusable preset
  list pages|components|data [<p>]  List resources
  list presets                   List available presets
  serve [--port <n>] [--watch]  Start dev server on build/ directory
  css <page>                    Output assembled CSS for a page (global + all component styles)

Flags:
  --verbose    Enable debug logging
  --strict     Treat warnings as errors
  --compact    Render without annotation header (render page only)
  --help       Show this help

Page arguments accept both "build page <p>" and "build <p>".
`;

// ── Entry point ─────────────────────────────────────────

export async function run(argv: string[], sink: Io = defaultIo): Promise<number> {
  io = sink;
  ROOT = process.cwd();

  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv);
  } catch (e) {
    if (e instanceof EngineError) { io.err(e.format() + '\n'); return 1; }
    throw e;
  }

  verbose = parsed.flags.has('--verbose');
  strict = parsed.flags.has('--strict');
  flags = parsed.flags;

  if (parsed.flags.has('--help') || argv.length === 0) {
    io.out(HELP);
    return 0;
  }

  const handler = handlers[parsed.command];
  if (!handler) {
    io.err(`Unknown command: ${parsed.command}\nRun: htmlng --help\n`);
    return 1;
  }

  try {
    return (await handler(parsed.args)) ?? 0;
  } catch (e) {
    if (e instanceof EngineError) {
      io.err(e.format() + '\n');
      if (e.level === 'WARNING' && !strict) return 0;
      return 1;
    }
    io.err(`FATAL: ${(e as Error).message}\n`);
    return 1;
  }
}

// ── Validation helpers ──────────────────────────────────

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

function requireName(value: string | undefined, label: string, usage: string): string {
  if (!value) {
    throw new EngineError(`Missing ${label} name`, '', undefined, 'ERROR', `Usage: ${usage}`);
  }
  if (!NAME_RE.test(value)) {
    throw new EngineError(
      `Invalid ${label} name "${value}"`,
      '', undefined, 'ERROR',
      `Names must match ${NAME_RE} (letters, digits, "-" and "_"; no path separators).`,
    );
  }
  return value;
}

// ── Command handlers ────────────────────────────────────

async function cmdInit(_args: string[]): Promise<number> {
  initProject(ROOT, flag('--name') ?? undefined);
  const name = flag('--name');
  io.out(`Initialized project${name ? ` "${name}"` : ''}.\n`);
  return 0;
}

async function cmdCreate(args: string[]): Promise<number> {
  const what = args[0];
  if (what === 'component') {
    const name = requireName(args[1], 'component', 'htmlng create component <name> [--preset <p>]');
    const preset = flag('--preset');
    if (preset) {
      scaffoldPresetComponent(ROOT, name, preset);
      io.out(`Created components/${name}.component.html from preset "${preset}"\n`);
    } else {
      scaffoldComponent(ROOT, name);
      io.out(`Created components/${name}.component.html\n`);
    }
    return 0;
  }
  if (what === 'page') {
    const name = requireName(args[1], 'page', 'htmlng create page <name>');
    scaffoldPage(ROOT, name);
    io.out(`Created pages/${name}.page.yaml\n`);
    return 0;
  }
  if (what === 'data') {
    const comp = requireName(args[1], 'component', 'htmlng create data <component> --page <page>');
    const page = flag('--page');
    if (!page) {
      io.err('Error: --page <page> is required\n');
      return 1;
    }
    scaffoldData(ROOT, page, comp);
    io.out(`Created data/${page}/${comp}.yaml\n`);
    return 0;
  }
  io.err('Usage: htmlng create component|page|data ...\nRun: htmlng --help\n');
  return 1;
}

async function cmdRender(args: string[]): Promise<number> {
  const withCSS = has('--with-css');
  const sub = args[0];

  if (sub === 'component') {
    const name = requireName(args[1], 'component', 'htmlng render component <name> --page <page>');
    if (has('--all')) {
      const config = loadConfig(ROOT);
      const pages = findPages(join(ROOT, config.paths.pages));
      for (const p of pages) {
        try {
          const data = loadData(ROOT, p, name);
          const isEmpty = Array.isArray(data) ? data.length === 0 : Object.keys(data).length === 0;
          if (isEmpty) continue;
          const html = renderComponent(ROOT, name, p);
          io.out(`=== COMPONENT: ${name}\n=== PAGE: ${p}\n=== STATUS: rendered\n\n${html}\n`);
        } catch (e) {
          if (e instanceof EngineError) {
            io.out(`=== COMPONENT: ${name}\n=== PAGE: ${p}\n=== STATUS: error\n${e.format()}\n\n`);
          } else throw e;
        }
      }
      return 0;
    }

    const page = flag('--page');
    if (!page) {
      io.err('Error: --page <page> is required (or use --all)\n');
      return 1;
    }
    const html = renderComponent(ROOT, name, page);
    if (withCSS) {
      io.out(wrapWithCSS(ROOT, name, html));
    } else {
      const changed = getChangedSources(ROOT, page);
      const status = isStale(ROOT, page) ? `rendered (changed: ${changed.join(', ') || 'unknown'})` : 'cached (no source changes)';
      io.out(`=== COMPONENT: ${name}\n=== PAGE: ${page}\n=== STATUS: ${status}\n\n${html}\n`);
    }
    return 0;
  }

  if (sub === 'page') {
    const name = requireName(args[1], 'page', 'htmlng render page <name> [--compact]');
    log(`Rendering page: ${name}`);
    const config = loadConfig(ROOT);
    const html = renderPage(ROOT, name, config.build.inlineCSS);
    const changed = getChangedSources(ROOT, name);
    const status = isStale(ROOT, name)
      ? `rendered (changed: ${changed.join(', ') || 'unknown'})`
      : 'cached (no source changes)';
    const page = parsePage(join(ROOT, config.paths.pages, `${name}.page.yaml`));
    if (!has('--compact')) {
      const cssRef = config.build.inlineCSS
        ? `inline <style> (global + ${page.components.length} components)`
        : `css/${name}.css (global + ${page.components.length} components)`;
      io.out(
        `=== PAGE: ${name}\n=== STATUS: ${status}\n` +
        `=== COMPONENTS: ${page.components.join(', ')}\n` +
        `=== CSS: ${cssRef}\n\n`
      );
    }
    io.out(html + '\n');
    return 0;
  }

  io.err('Usage: htmlng render component|page ...\nRun: htmlng --help\n');
  return 1;
}

async function cmdPreview(args: string[]): Promise<number> {
  const name = requireName(args[1], 'component', 'htmlng preview component <name> [--with-css]');
  const withCSS = has('--with-css');
  const html = previewComponent(ROOT, name);
  if (withCSS) {
    io.out(wrapWithCSS(ROOT, name, html));
  } else {
    io.out(`=== COMPONENT: ${name} (preview)\n=== STATUS: sample data\n\n${html}\n`);
  }
  return 0;
}

async function cmdValidate(args: string[]): Promise<number> {
  log('Validating...');
  const errors: EngineError[] = [];
  const warnings: EngineError[] = [];
  const config = loadConfig(ROOT);

  const collect = (fn: () => void) => {
    try { fn(); }
    catch (e) {
      if (e instanceof EngineError) errors.push(e);
      else throw e;
    }
  };

  const target = args[0];
  if (target === 'page' && args[1]) {
    collect(() => validatePageStructure(renderPage(ROOT, args[1])));
  } else if (target === 'component' && args[1]) {
    const comp = parseComponent(join(ROOT, config.paths.components, `${args[1]}.component.html`));
    collect(() => { warnings.push(...validateComponent(comp)); });
  } else if (target) {
    io.err(`Usage: htmlng validate [page <p>|component <c>]\nRun: htmlng --help\n`);
    return 1;
  } else {
    // Validate every page, collecting all failures instead of stopping at the first
    for (const p of findPages(join(ROOT, config.paths.pages))) {
      collect(() => validatePageStructure(renderPage(ROOT, p)));
    }
    for (const c of findComponents(join(ROOT, config.paths.components))) {
      collect(() => { warnings.push(...validateComponent(parseComponent(join(ROOT, config.paths.components, `${c}.component.html`)))); });
    }
  }

  for (const e of errors) io.err(e.format() + '\n');
  for (const w of warnings) io.err(w.format() + '\n');

  if (errors.length > 0) {
    io.err(`Validation failed: ${errors.length} error(s).\n`);
    return 1;
  }
  if (warnings.length > 0) {
    io.out(`Validation passed with ${warnings.length} warning(s).\n`);
    return strict ? 1 : 0;
  }
  io.out('Validation passed.\n');
  return 0;
}

/**
 * Render + write pages, and refresh the cache. Single source of truth shared by
 * `build`, `watch`, and `serve --watch`.
 *
 * With no explicit page list, `build/` is wiped first so deleted/renamed pages
 * cannot linger (spec C14). Targeted builds leave other pages untouched.
 */
function buildPages(pageNames?: string[]): string[] {
  const config = loadConfig(ROOT);
  const buildDir = join(ROOT, config.paths.build);
  const targeted = pageNames !== undefined;

  if (!targeted) rmSync(buildDir, { recursive: true, force: true });
  mkdirSync(buildDir, { recursive: true });
  if (!config.build.inlineCSS) mkdirSync(join(buildDir, 'css'), { recursive: true });

  const pages = pageNames ?? findPages(join(ROOT, config.paths.pages));

  for (const p of pages) {
    const html = renderPage(ROOT, p, config.build.inlineCSS);
    writeFileSync(join(buildDir, `${p}.html`), html);

    if (!config.build.inlineCSS) {
      const page = parsePage(join(ROOT, config.paths.pages, `${p}.page.yaml`));
      const allComps = page.components.map(n =>
        parseComponent(join(ROOT, config.paths.components, `${n}.component.html`))
      );
      let globalCSS = readFileSync(join(ROOT, 'global.css'), 'utf-8');
      globalCSS = resolveTokens(globalCSS, loadDesignTokens(ROOT));
      writeFileSync(join(buildDir, 'css', `${p}.css`), assemblePageCSS(allComps, globalCSS));
    }

    updateCache(ROOT, p, html);
  }

  copyAssets(ROOT);
  return pages;
}

/** Resolve an optional page argument: `page <p>`, bare `<p>`, or undefined for all. */
function pageTarget(args: string[]): string | undefined {
  if (args[0] === 'page') return args[1];
  return args[0];
}

async function cmdBuild(args: string[]): Promise<number> {
  log('Building...');
  const target = pageTarget(args);
  const pages = buildPages(target ? [target] : undefined);
  const buildDir = join(ROOT, loadConfig(ROOT).paths.build);
  io.out(`Built ${pages.length} page(s) to ${relative(ROOT, buildDir)}/\n`);
  return 0;
}

async function cmdDiff(args: string[]): Promise<number> {
  const config = loadConfig(ROOT);
  const buildDir = join(ROOT, config.paths.build);
  const target = pageTarget(args);
  const pages = target ? [target] : findPages(join(ROOT, config.paths.pages));

  let allUpToDate = true;

  for (const p of pages) {
    const newHtml = renderPage(ROOT, p);
    const oldPath = join(buildDir, `${p}.html`);
    let oldHtml = '';
    try { oldHtml = readFileSync(oldPath, 'utf-8'); } catch { /* no old build */ }

    if (oldHtml && oldHtml !== newHtml) {
      io.out(createTwoFilesPatch(`${p}.html`, `${p}.html`, oldHtml, newHtml) + '\n');
      allUpToDate = false;
    } else if (!oldHtml) {
      io.out(`=== PAGE: ${p} === (no previous build to diff against)\n`);
      allUpToDate = false;
    }
  }

  if (allUpToDate && pages.length > 0) {
    io.out('All pages up to date.\n');
  }
  return 0;
}

async function cmdWatch(_args: string[]): Promise<number> {
  log('Starting watch mode...');
  const { watch } = await import('chokidar');
  const config = loadConfig(ROOT);

  buildPages();
  io.out('Watching for changes...\n');

  const watcher = watch([
    join(ROOT, config.paths.components),
    join(ROOT, config.paths.pages),
    join(ROOT, config.paths.data),
    join(ROOT, 'global.css'),
    join(ROOT, 'design-tokens.yaml'),
  ], {
    ignored: ['**/node_modules/**', '**/.engine-cache.json'],
    persistent: true,
  });

  let timeout: ReturnType<typeof setTimeout> | null = null;

  watcher.on('change', (fp: string) => schedule(fp));
  watcher.on('add', (fp: string) => schedule(fp));

  function schedule(filePath: string) {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => rebuild(filePath), 100);
  }

  function rebuild(filePath: string) {
    const rel = relative(ROOT, filePath);
    const pages = affectedPages(ROOT, rel);
    if (pages.length === 0) return;

    try {
      buildPages(pages);
      io.out(`=== REBUILT: ${pages.join(', ')} (changed: ${rel})\n`);
    } catch (e) {
      if (e instanceof EngineError) io.err(e.format() + '\n');
      else throw e;
    }
  }

  process.on('SIGINT', () => { watcher.close(); process.exit(0); });
  await new Promise(() => {});
  return 0;
}

async function cmdAdd(args: string[]): Promise<number> {
  const idx = args.indexOf('component');
  const name = idx !== -1 ? args[idx + 1] : undefined;
  const page = flag('--page');
  if (!name || !page) {
    io.err('Usage: htmlng add component <name> --page <page>\n');
    return 1;
  }

  const config = loadConfig(ROOT);
  const pagePath = join(ROOT, config.paths.pages, `${page}.page.yaml`);
  const p = parsePage(pagePath);

  if (p.components.includes(name)) {
    io.out(`Component "${name}" is already in page "${page}".\n`);
    return 0;
  }

  p.components.push(name);

  // Rebuild the YAML from the parsed object so comments/formatting are not corrupted
  const raw = load(readFileSync(pagePath, 'utf-8')) as Record<string, unknown>;
  raw.components = p.components;
  writeFileSync(pagePath, dump(raw, { lineWidth: -1 }));
  io.out(`Added "${name}" to page "${page}".\n`);
  return 0;
}

async function cmdList(args: string[]): Promise<number> {
  const config = loadConfig(ROOT);
  const what = args[0];

  if (what === 'presets') {
    io.out(listPresets(ROOT).join('\n') + '\n');
    return 0;
  }
  if (what === 'pages') {
    io.out(findPages(join(ROOT, config.paths.pages)).join('\n') + '\n');
    return 0;
  }
  if (what === 'components') {
    io.out(findComponents(join(ROOT, config.paths.components)).join('\n') + '\n');
    return 0;
  }
  if (what === 'data') {
    const page = args[1];
    if (!page) {
      io.err('Usage: htmlng list data <page>\n');
      return 1;
    }
    try {
      const { readdirSync } = await import('node:fs');
      const files = readdirSync(join(ROOT, config.paths.data, page)).filter(f => f.endsWith('.yaml'));
      io.out(files.map(f => f.replace('.yaml', '')).join('\n') + '\n');
    } catch {
      io.out('(no data files)\n');
    }
    return 0;
  }

  io.err('Usage: htmlng list pages|components|data <page>|presets\nRun: htmlng --help\n');
  return 1;
}

async function cmdServe(args: string[]): Promise<number> {
  const config = loadConfig(ROOT);
  const buildDir = join(ROOT, config.paths.build);
  const port = parseInt(flag('--port') ?? '3000', 10);
  const watching = has('--watch');

  const { createServer } = await import('node:http');
  const { existsSync } = await import('node:fs');
  const { extname } = await import('node:path');

  const MIME: Record<string, string> = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.txt': 'text/plain',
  };

  // SSE clients for hot reload
  const clients: Array<{ write: (data: string) => void }> = [];

  const RELOAD_SCRIPT = `\n<script>\nnew EventSource('/__htmlng_reload').onmessage = () => location.reload();\n</script>`;

  const server = createServer((req, res) => {
    const rawUrl = (req.url ?? '/').split('?')[0];
    const url = rawUrl === '/' ? '/index.html' : rawUrl;

    // SSE endpoint for hot reload
    if (watching && url === '/__htmlng_reload') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.write('data: connected\n\n');
      const client = { write: (data: string) => res.write(data) };
      clients.push(client);
      req.on('close', () => {
        const idx = clients.indexOf(client);
        if (idx !== -1) clients.splice(idx, 1);
      });
      return;
    }

    // Confine every request to buildDir — reject path traversal
    const resolved = resolve(buildDir, `.${url}`);
    if (resolved !== buildDir && !resolved.startsWith(buildDir + sep)) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    if (!existsSync(resolved)) { res.writeHead(404); res.end('Not found'); return; }

    let content = readFileSync(resolved, 'utf-8');
    const ext = extname(resolved);

    // Inject reload script into HTML if watching
    if (watching && ext === '.html') {
      content = content.replace('</body>', RELOAD_SCRIPT + '</body>');
    }

    res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
    res.end(content);
  });

  server.listen(port, () => {
    io.out(`Serving ${relative(ROOT, buildDir)}/ at http://localhost:${port}\n`);
    if (watching) io.out(`Hot reload enabled — watching for changes\n`);
  });

  if (watching) {
    const { watch } = await import('chokidar');
    const watcher = watch([
      join(ROOT, config.paths.components),
      join(ROOT, config.paths.pages),
      join(ROOT, config.paths.data),
      join(ROOT, 'global.css'),
      join(ROOT, 'design-tokens.yaml'),
    ], { ignored: ['**/node_modules/**'] });

    let timeout: ReturnType<typeof setTimeout> | null = null;
    watcher.on('change', () => {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        try {
          buildPages();
          io.out('[rebuilt]\n');
          for (const client of clients) client.write('data: reload\n\n');
          clients.length = 0;
        } catch (e) {
          if (e instanceof EngineError) io.err(e.format() + '\n');
          else throw e;
        }
      }, 100);
    });
  }

  return 0;
}

async function cmdSave(args: string[]): Promise<number> {
  const presetName = flag('--as-preset');
  const idx = args.indexOf('component');
  const compName = idx !== -1 ? args[idx + 1] : undefined;
  if (!compName || !presetName) {
    io.err('Usage: htmlng save component <name> --as-preset <preset-name>\n');
    return 1;
  }
  savePreset(ROOT, compName, presetName);
  io.out(`Saved "${compName}" as preset "${presetName}".\n`);
  return 0;
}

async function cmdMove(args: string[]): Promise<number> {
  const idx = args.indexOf('component');
  const name = idx !== -1 ? args[idx + 1] : undefined;
  const page = flag('--page');
  const before = flag('--before');
  const after = flag('--after');
  if (!name || !page || (!before && !after)) {
    io.err('Usage: htmlng move component <name> --page <page> --before|--after <other>\n');
    return 1;
  }

  const config = loadConfig(ROOT);
  const pagePath = join(ROOT, config.paths.pages, `${page}.page.yaml`);
  const p = parsePage(pagePath);

  const current = p.components.indexOf(name);
  if (current === -1) {
    io.err(`Component "${name}" not in page "${page}".\n`);
    return 1;
  }

  const target = before ?? after!;
  const targetIdx = p.components.indexOf(target);
  if (targetIdx === -1) {
    io.err(`Component "${target}" not in page "${page}".\n`);
    return 1;
  }

  p.components.splice(current, 1);
  const insertAt = before ? p.components.indexOf(target) : p.components.indexOf(target) + 1;
  p.components.splice(insertAt, 0, name);

  const raw = load(readFileSync(pagePath, 'utf-8')) as Record<string, unknown>;
  raw.components = p.components;
  writeFileSync(pagePath, dump(raw, { lineWidth: -1 }));
  io.out(`Moved "${name}" ${before ? 'before' : 'after'} "${target}" in page "${page}".\n`);
  return 0;
}

async function cmdCSS(args: string[]): Promise<number> {
  const pageName = args[0];
  if (!pageName) {
    io.err('Usage: htmlng css <page>\n');
    return 1;
  }

  const config = loadConfig(ROOT);
  const page = parsePage(join(ROOT, config.paths.pages, `${pageName}.page.yaml`));

  const allComps = page.components.map(n =>
    parseComponent(join(ROOT, config.paths.components, `${n}.component.html`))
  );
  let globalCSS = readFileSync(join(ROOT, 'global.css'), 'utf-8');
  globalCSS = resolveTokens(globalCSS, loadDesignTokens(ROOT));

  const assembled = assemblePageCSS(allComps, globalCSS);

  io.out(`=== PAGE: ${pageName} ===\n`);
  io.out(`=== COMPONENTS: ${page.components.join(', ')} ===\n`);
  io.out(`=== Global CSS + ${page.components.length} component CSS blocks ===\n\n`);
  io.out(assembled + '\n');
  return 0;
}

function wrapWithCSS(rootDir: string, componentName: string, innerHTML: string): string {
  const config = loadConfig(rootDir);
  const comp = parseComponent(join(rootDir, config.paths.components, `${componentName}.component.html`));
  let globalCSS = readFileSync(join(rootDir, 'global.css'), 'utf-8');
  globalCSS = resolveTokens(globalCSS, loadDesignTokens(rootDir));
  const scopedCSS = assemblePageCSS([comp], globalCSS);

  return `<!DOCTYPE html>\n<html>\n<head>\n<meta charset="UTF-8">\n<style>\n${scopedCSS}\n</style>\n</head>\n<body>\n  <div class="${escAttr(componentName)}">\n${ind(innerHTML, 4)}\n  </div>\n</body>\n</html>`;
}

function ind(s: string, n: number): string { const p = ' '.repeat(n); return s.split('\n').map(l => p + l).join('\n'); }
function escAttr(s: string): string { return s.replace(/"/g, '&quot;'); }
