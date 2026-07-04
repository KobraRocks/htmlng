import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { EngineError } from './types.js';
import { renderPage, renderComponent, previewComponent } from './renderer.js';
import { isStale, getChangedSources, updateCache } from './hasher.js';
import { affectedPages } from './propagation.js';
import { copyAssets } from './copier.js';
import {
  initProject,
  scaffoldComponent,
  scaffoldPage,
  scaffoldData,
} from './scaffold.js';
import { validateComponent, validatePageData, validatePageStructure } from './validator.js';
import { parseComponent } from './component.js';
import { parsePage } from './page.js';
import { loadData } from './data-file.js';
import { createTwoFilesPatch } from 'diff';
import { readFileSync } from 'node:fs';
import { loadConfig } from './config.js';

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

Usage: engine <command> [args]

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

export async function run(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    process.stdout.write(HELP);
    process.exit(0);
  }

  verbose = args.includes('--verbose');
  strict = args.includes('--strict');

  const filtered = args.filter(a => !a.startsWith('--') || a === '--page' || a === '--all' || a === '--compact' || a === '--name');

  const command = filtered[0];
  const handler = handlers[command];

  if (!handler) {
    process.stderr.write(`Unknown command: ${command}\nRun: engine --help\n`);
    process.exit(1);
  }

  try {
    await handler(filtered.slice(1));
  } catch (e) {
    if (e instanceof EngineError) {
      if (e.level === 'WARNING') {
        process.stderr.write(e.format() + '\n');
        if (strict) process.exit(1);
      } else {
        process.stderr.write(e.format() + '\n');
        process.exit(1);
      }
    } else {
      process.stderr.write(`FATAL: ${(e as Error).message}\n`);
      process.exit(1);
    }
  }
}

function log(...args: unknown[]) { if (verbose) console.error('[debug]', ...args); }

// ── Command handlers ────────────────────────────────────

async function cmdInit(args: string[]) {
  const nameIdx = args.indexOf('--name');
  const name = nameIdx !== -1 ? args[nameIdx + 1] : undefined;
  initProject(ROOT, name);
  process.stdout.write(`Initialized project${name ? ` "${name}"` : ''}.\n`);
}

async function cmdCreate(args: string[]) {
  const what = args[0]; // "component" | "page" | "data"
  if (what === 'component') {
    scaffoldComponent(ROOT, args[1]);
    process.stdout.write(`Created components/${args[1]}.component.html\n`);
  } else if (what === 'page') {
    scaffoldPage(ROOT, args[1]);
    process.stdout.write(`Created pages/${args[1]}.page.yaml\n`);
  } else if (what === 'data') {
    const comp = args[1];
    const pageIdx = args.indexOf('--page');
    const page = pageIdx !== -1 ? args[pageIdx + 1] : null;
    if (!page) { process.stderr.write('Error: --page <page> is required\n'); process.exit(1); }
    scaffoldData(ROOT, page, comp);
    process.stdout.write(`Created data/${page}/${comp}.yaml\n`);
  }
}

async function cmdRender(args: string[]) {
  const sub = args[0]; // "component" | "page"
  if (sub === 'component') {
    const name = args[1];
    const all = args.includes('--all');
    if (all) {
      // Render with all pages' data
      const config = loadConfig(ROOT);
      const { findPages } = await import('./page.js');
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
      const pageIdx = args.indexOf('--page');
      const page = pageIdx !== -1 ? args[pageIdx + 1] : null;
      if (!page) { process.stderr.write('Error: --page <page> is required (or use --all)\n'); process.exit(1); }
      const html = renderComponent(ROOT, name, page);
      const changed = getChangedSources(ROOT, page);
      const status = isStale(ROOT, page) ? `rendered (changed: ${changed.join(', ') || 'unknown'})` : 'cached (no source changes)';
      process.stdout.write(`=== COMPONENT: ${name}\n=== PAGE: ${page}\n=== STATUS: ${status}\n\n${html}\n`);
    }
  } else if (sub === 'page') {
    const name = args[1];
    const compact = args.includes('--compact');
    log(`Rendering page: ${name}`);
    const html = renderPage(ROOT, name);
    const changed = getChangedSources(ROOT, name);
    const status = isStale(ROOT, name)
      ? `rendered (changed: ${changed.join(', ') || 'unknown'})`
      : 'cached (no source changes)';
    const config = loadConfig(ROOT);
    const page = parsePage(join(ROOT, config.paths.pages, `${name}.page.yaml`));
    if (!compact) {
      process.stdout.write(`=== PAGE: ${name}\n=== STATUS: ${status}\n=== COMPONENTS: ${page.components.join(', ')}\n=== CSS: css/${name}.css (global + ${page.components.length} components)\n\n`);
    }
    process.stdout.write(html + '\n');
  }
}

async function cmdPreview(args: string[]) {
  const name = args[1]; // args[0] = "component"
  const html = previewComponent(ROOT, name);
  process.stdout.write(`=== COMPONENT: ${name} (preview)\n=== STATUS: sample data\n\n${html}\n`);
}

async function cmdValidate(args: string[]) {
  log('Validating...');
  const warnings: EngineError[] = [];
  const config = loadConfig(ROOT);
  const { findPages, parsePage } = await import('./page.js');

  const target = args[0]; // optional: "page" | "component"
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
        const html = renderPage(ROOT, p);
        validatePageStructure(html);
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

  const target = args[1]; // optional page name
  const { findPages } = await import('./page.js');
  const pages = target ? [target] : findPages(join(ROOT, config.paths.pages));

  for (const p of pages) {
    const html = renderPage(ROOT, p);
    writeFileSync(join(buildDir, `${p}.html`), html);

    const config = loadConfig(ROOT);
    const page = parsePage(join(ROOT, config.paths.pages, `${p}.page.yaml`));
    const allComps = page.components.map(n =>
      parseComponent(join(ROOT, config.paths.components, `${n}.component.html`))
    );
    const { assemblePageCSS } = await import('./css.js');
    const globalCSS = readFileSync(join(ROOT, 'global.css'), 'utf-8');
    const css = assemblePageCSS(allComps, globalCSS);
    writeFileSync(join(buildDir, 'css', `${p}.css`), css);

    updateCache(ROOT, p, html);
  }

  copyAssets(ROOT);
  process.stdout.write(`Built ${pages.length} page(s) to ${relative(ROOT, buildDir)}/\n`);
}

async function cmdDiff(args: string[]) {
  const config = loadConfig(ROOT);
  const buildDir = join(ROOT, config.paths.build);
  const { findPages } = await import('./page.js');

  const target = args[1]; // optional page name
  const pages = target ? [target] : findPages(join(ROOT, config.paths.pages));

  for (const p of pages) {
    const newHtml = renderPage(ROOT, p);
    const oldPath = join(buildDir, `${p}.html`);
    let oldHtml = '';
    try { oldHtml = readFileSync(oldPath, 'utf-8'); } catch { /* no old build */ }

    if (oldHtml && oldHtml !== newHtml) {
      const patch = createTwoFilesPatch(`${p}.html`, `${p}.html`, oldHtml, newHtml);
      process.stdout.write(patch + '\n');
    } else if (!oldHtml) {
      process.stdout.write(`=== PAGE: ${p} === (no previous build to diff against)\n`);
    }
  }

  if (pages.every(p => {
    try {
      const old = readFileSync(join(buildDir, `${p}.html`), 'utf-8');
      return old === renderPage(ROOT, p);
    } catch { return false; }
  })) {
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

  const rebuild = (filePath: string) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => {
      const relativePath = relative(ROOT, filePath);
      const pages = affectedPages(ROOT, relativePath);
      if (pages.length === 0) return;

      for (const p of pages) {
        try {
          const html = renderPage(ROOT, p);
          process.stdout.write(`=== REBUILT: ${p} (changed: ${relativePath})\n`);
          // Show diff if there's a previous build
          const oldPath = join(ROOT, config.paths.build, `${p}.html`);
          try {
            const oldHtml = readFileSync(oldPath, 'utf-8');
            if (oldHtml !== html) {
              const patch = createTwoFilesPatch(`${p}.html`, `${p}.html`, oldHtml, html);
              process.stdout.write(patch + '\n');
            }
          } catch { /* no old build */ }
        } catch (e) {
          if (e instanceof EngineError) process.stderr.write(e.format() + '\n');
        }
      }
    }, 100); // 100ms debounce
  };

  watcher.on('change', rebuild);
  watcher.on('add', rebuild);

  process.stdout.write('Watching for changes...\n');
  process.on('SIGINT', () => { watcher.close(); process.exit(0); });

  // Keep running
  await new Promise(() => {});
}

async function cmdAdd(args: string[]) {
  const compIdx = args.indexOf('component');
  const name = args[compIdx + 1];
  const pageIdx = args.indexOf('--page');
  const page = pageIdx !== -1 ? args[pageIdx + 1] : null;
  if (!name || !page) { process.stderr.write('Usage: engine add component <name> --page <page>\n'); process.exit(1); }

  const config = loadConfig(ROOT);
  const pagePath = join(ROOT, config.paths.pages, `${page}.page.yaml`);
  const p = parsePage(pagePath);

  if (p.components.includes(name)) {
    process.stdout.write(`Component "${name}" is already in page "${page}".\n`);
    return;
  }

  p.components.push(name);

  // Rewrite page YAML preserving structure
  const content = readFileSync(pagePath, 'utf-8');
  const newContent = content.replace(
    /components:\s*(\[[\s\S]*?\]|(\n\s*-.*)+)/,
    (_match) => {
      return 'components:\n' + p.components.map(c => `  - ${c}`).join('\n');
    },
  );
  writeFileSync(pagePath, newContent);
  process.stdout.write(`Added "${name}" to page "${page}".\n`);
}

async function cmdList(args: string[]) {
  const what = args[0]; // "pages" | "components" | "data"
  const config = loadConfig(ROOT);
  const { findPages, parsePage } = await import('./page.js');
  const { findComponents } = await import('./component.js');

  if (what === 'pages') {
    const pages = findPages(join(ROOT, config.paths.pages));
    process.stdout.write(pages.join('\n') + '\n');
  } else if (what === 'components') {
    const comps = findComponents(join(ROOT, config.paths.components));
    process.stdout.write(comps.join('\n') + '\n');
  } else if (what === 'data') {
    const page = args[1];
    if (!page) { process.stderr.write('Usage: engine list data <page>\n'); process.exit(1); }
    const dataDir = join(ROOT, config.paths.data, page);
    try {
      const { readdirSync } = await import('node:fs');
      const files = readdirSync(dataDir).filter(f => f.endsWith('.yaml'));
      process.stdout.write(files.map(f => f.replace('.yaml', '')).join('\n') + '\n');
    } catch {
      process.stdout.write('(no data files)\n');
    }
  }
}
