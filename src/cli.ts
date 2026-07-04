import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createTwoFilesPatch } from 'diff';
import { load, dump } from 'js-yaml';
import { EngineError } from './types.js';
import { loadConfig } from './config.js';
import { renderPage, renderComponent, previewComponent } from './renderer.js';
import { isStale, getChangedSources, updateCache } from './hasher.js';
import { affectedPages } from './propagation.js';
import { copyAssets } from './copier.js';
import { initProject, scaffoldComponent, scaffoldPage, scaffoldData } from './scaffold.js';
import { validateComponent, validatePageStructure } from './validator.js';
import { parseComponent, findComponents } from './component.js';
import { parsePage, findPages } from './page.js';
import { loadData } from './data-file.js';

const ROOT = process.cwd();
let verbose = false;
let strict = false;

type Handler = (args: string[]) => Promise<void>;

const handlers: Record<string, Handler> = {
  init:    cmdInit,
  create:  cmdCreate,
  render:  cmdRender,
  preview: cmdPreview,
  validate: cmdValidate,
  build:   cmdBuild,
  diff:    cmdDiff,
  watch:   cmdWatch,
  add:     cmdAdd,
  list:    cmdList,
};

const HELP = `HTML Engine — deterministic component-based HTML generator

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
  validate [page <p>]            Validate all or specific page
  build [page <p>]               Build pages to build/ directory
  diff [page <p>]                Show unified diff vs last build
  watch                          Watch files and rebuild on change
  add component <c> --page <p>   Add component to page
  list pages|components|data [<p>]  List resources

Flags:
  --verbose    Enable debug logging
  --strict     Treat warnings as errors
  --compact    Render without annotation header (render page only)
  --help       Show this help
`;

// ── Arg helpers ─────────────────────────────────────────

function flag(args: string[], name: string): string | null {
  const i = args.indexOf(name);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : null;
}

function has(args: string[], name: string): boolean {
  return args.includes(name);
}

// ── Entry point ─────────────────────────────────────────

export async function run(args: string[]): Promise<void> {
  if (has(args, '--help') || has(args, '-h') || args.length === 0) {
    process.stdout.write(HELP);
    process.exit(0);
  }

  verbose = has(args, '--verbose');
  strict = has(args, '--strict');

  const KEEP = new Set(['--page', '--all', '--compact', '--name']);
  const filtered = args.filter(a => !a.startsWith('--') || KEEP.has(a));

  const command = filtered[0];
  const handler = handlers[command];

  if (!handler) {
    process.stderr.write(`Unknown command: ${command}\nRun: htmlng --help\n`);
    process.exit(1);
  }

  try {
    await handler(filtered.slice(1));
  } catch (e) {
    if (e instanceof EngineError) {
      process.stderr.write(e.format() + '\n');
      if (e.level === 'WARNING' && !strict) return;
      process.exit(1);
    }
    process.stderr.write(`FATAL: ${(e as Error).message}\n`);
    process.exit(1);
  }
}

function log(...args: unknown[]) { if (verbose) console.error('[debug]', ...args); }

// ── Command handlers ────────────────────────────────────

async function cmdInit(args: string[]) {
  initProject(ROOT, flag(args, '--name') ?? undefined);
  const name = flag(args, '--name');
  process.stdout.write(`Initialized project${name ? ` "${name}"` : ''}.\n`);
}

async function cmdCreate(args: string[]) {
  const what = args[0];
  if (what === 'component') {
    scaffoldComponent(ROOT, args[1]);
    process.stdout.write(`Created components/${args[1]}.component.html\n`);
  } else if (what === 'page') {
    scaffoldPage(ROOT, args[1]);
    process.stdout.write(`Created pages/${args[1]}.page.yaml\n`);
  } else if (what === 'data') {
    const comp = args[1];
    const page = flag(args, '--page');
    if (!page) { process.stderr.write('Error: --page <page> is required\n'); process.exit(1); }
    scaffoldData(ROOT, page, comp);
    process.stdout.write(`Created data/${page}/${comp}.yaml\n`);
  }
}

async function cmdRender(args: string[]) {
  const sub = args[0];
  if (sub === 'component') {
    const name = args[1];
    if (has(args, '--all')) {
      const config = loadConfig(ROOT);
      const pages = findPages(join(ROOT, config.paths.pages));
      for (const p of pages) {
        try {
          const data = loadData(ROOT, p, name);
          if (Object.keys(data).length === 0) continue;
          const html = renderComponent(ROOT, name, p);
          process.stdout.write(`=== COMPONENT: ${name}\n=== PAGE: ${p}\n=== STATUS: rendered\n\n${html}\n`);
        } catch (e) {
          if (e instanceof EngineError) {
            process.stdout.write(`=== COMPONENT: ${name}\n=== PAGE: ${p}\n=== STATUS: error\n${e.format()}\n\n`);
          }
        }
      }
    } else {
      const page = flag(args, '--page');
      if (!page) { process.stderr.write('Error: --page <page> is required (or use --all)\n'); process.exit(1); }
      const html = renderComponent(ROOT, name, page);
      const changed = getChangedSources(ROOT, page);
      const status = isStale(ROOT, page) ? `rendered (changed: ${changed.join(', ') || 'unknown'})` : 'cached (no source changes)';
      process.stdout.write(`=== COMPONENT: ${name}\n=== PAGE: ${page}\n=== STATUS: ${status}\n\n${html}\n`);
    }
  } else if (sub === 'page') {
    const name = args[1];
    log(`Rendering page: ${name}`);
    const html = renderPage(ROOT, name);
    const changed = getChangedSources(ROOT, name);
    const status = isStale(ROOT, name)
      ? `rendered (changed: ${changed.join(', ') || 'unknown'})`
      : 'cached (no source changes)';
    const config = loadConfig(ROOT);
    const page = parsePage(join(ROOT, config.paths.pages, `${name}.page.yaml`));
    if (!has(args, '--compact')) {
      process.stdout.write(
        `=== PAGE: ${name}\n=== STATUS: ${status}\n` +
        `=== COMPONENTS: ${page.components.join(', ')}\n` +
        `=== CSS: css/${name}.css (global + ${page.components.length} components)\n\n`
      );
    }
    process.stdout.write(html + '\n');
  }
}

async function cmdPreview(args: string[]) {
  const name = args[1];
  const html = previewComponent(ROOT, name);
  process.stdout.write(`=== COMPONENT: ${name} (preview)\n=== STATUS: sample data\n\n${html}\n`);
}

async function cmdValidate(args: string[]) {
  log('Validating...');
  const warnings: EngineError[] = [];
  const config = loadConfig(ROOT);

  const target = args[0];
  if (target === 'page' && args[1]) {
    const html = renderPage(ROOT, args[1]);
    validatePageStructure(html);
  } else if (target === 'component' && args[1]) {
    const comp = parseComponent(join(ROOT, config.paths.components, `${args[1]}.component.html`));
    warnings.push(...validateComponent(comp));
  } else {
    const pages = findPages(join(ROOT, config.paths.pages));
    for (const p of pages) {
      try {
        validatePageStructure(renderPage(ROOT, p));
      } catch (e) {
        if (e instanceof EngineError) process.stderr.write(e.format() + '\n');
      }
    }
  }

  for (const w of warnings) process.stderr.write(w.format() + '\n');
  process.stdout.write('Validation passed.\n');
}

async function cmdBuild(args: string[]) {
  log('Building...');
  const config = loadConfig(ROOT);
  const buildDir = join(ROOT, config.paths.build);
  mkdirSync(join(buildDir, 'css'), { recursive: true });

  const pages = args[1] ? [args[1]] : findPages(join(ROOT, config.paths.pages));

  for (const p of pages) {
    const html = renderPage(ROOT, p);
    writeFileSync(join(buildDir, `${p}.html`), html);

    const page = parsePage(join(ROOT, config.paths.pages, `${p}.page.yaml`));
    const allComps = page.components.map(n =>
      parseComponent(join(ROOT, config.paths.components, `${n}.component.html`))
    );
    const { assemblePageCSS } = await import('./css.js');
    const globalCSS = readFileSync(join(ROOT, 'global.css'), 'utf-8');
    writeFileSync(join(buildDir, 'css', `${p}.css`), assemblePageCSS(allComps, globalCSS));

    updateCache(ROOT, p, html);
  }

  copyAssets(ROOT);
  process.stdout.write(`Built ${pages.length} page(s) to ${relative(ROOT, buildDir)}/\n`);
}

async function cmdDiff(args: string[]) {
  const config = loadConfig(ROOT);
  const buildDir = join(ROOT, config.paths.build);
  const pages = args[1] ? [args[1]] : findPages(join(ROOT, config.paths.pages));

  let allUpToDate = true;

  for (const p of pages) {
    const newHtml = renderPage(ROOT, p);
    const oldPath = join(buildDir, `${p}.html`);
    let oldHtml = '';
    try { oldHtml = readFileSync(oldPath, 'utf-8'); } catch { /* no old build */ }

    if (oldHtml && oldHtml !== newHtml) {
      process.stdout.write(createTwoFilesPatch(`${p}.html`, `${p}.html`, oldHtml, newHtml) + '\n');
      allUpToDate = false;
    } else if (!oldHtml) {
      process.stdout.write(`=== PAGE: ${p} === (no previous build to diff against)\n`);
      allUpToDate = false;
    }
  }

  if (allUpToDate && pages.length > 0) {
    process.stdout.write('All pages up to date.\n');
  }
}

async function cmdWatch(_args: string[]) {
  log('Starting watch mode...');
  const { watch } = await import('chokidar');
  const config = loadConfig(ROOT);

  const watcher = watch([
    join(ROOT, config.paths.components),
    join(ROOT, config.paths.pages),
    join(ROOT, config.paths.data),
    join(ROOT, 'global.css'),
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

    for (const p of pages) {
      try {
        const html = renderPage(ROOT, p);
        process.stdout.write(`=== REBUILT: ${p} (changed: ${rel})\n`);
        const oldPath = join(ROOT, config.paths.build, `${p}.html`);
        try {
          const oldHtml = readFileSync(oldPath, 'utf-8');
          if (oldHtml !== html) {
            process.stdout.write(createTwoFilesPatch(`${p}.html`, `${p}.html`, oldHtml, html) + '\n');
          }
        } catch { /* no old build */ }
      } catch (e) {
        if (e instanceof EngineError) process.stderr.write(e.format() + '\n');
      }
    }
  }

  process.stdout.write('Watching for changes...\n');
  process.on('SIGINT', () => { watcher.close(); process.exit(0); });
  await new Promise(() => {});
}

async function cmdAdd(args: string[]) {
  const name = args[args.indexOf('component') + 1];
  const page = flag(args, '--page');
  if (!name || !page) { process.stderr.write('Usage: engine add component <name> --page <page>\n'); process.exit(1); }

  const config = loadConfig(ROOT);
  const pagePath = join(ROOT, config.paths.pages, `${page}.page.yaml`);
  const p = parsePage(pagePath);

  if (p.components.includes(name)) {
    process.stdout.write(`Component "${name}" is already in page "${page}".\n`);
    return;
  }

  p.components.push(name);

  // Rebuild the YAML from the parsed object
  const raw = load(readFileSync(pagePath, 'utf-8')) as Record<string, unknown>;
  raw.components = p.components;
  writeFileSync(pagePath, dump(raw, { lineWidth: -1 }));
  process.stdout.write(`Added "${name}" to page "${page}".\n`);
}

async function cmdList(args: string[]) {
  const config = loadConfig(ROOT);
  const what = args[0];

  if (what === 'pages') {
    process.stdout.write(findPages(join(ROOT, config.paths.pages)).join('\n') + '\n');
  } else if (what === 'components') {
    process.stdout.write(findComponents(join(ROOT, config.paths.components)).join('\n') + '\n');
  } else if (what === 'data') {
    const page = args[1];
    if (!page) { process.stderr.write('Usage: engine list data <page>\n'); process.exit(1); }
    try {
      const { readdirSync } = await import('node:fs');
      const files = readdirSync(join(ROOT, config.paths.data, page)).filter(f => f.endsWith('.yaml'));
      process.stdout.write(files.map(f => f.replace('.yaml', '')).join('\n') + '\n');
    } catch {
      process.stdout.write('(no data files)\n');
    }
  }
}
