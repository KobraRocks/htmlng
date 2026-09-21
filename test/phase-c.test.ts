import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { run, JSON_SCHEMA_VERSION } from '../src/cli.js';
import { loadData } from '../src/data-file.js';
import { renderPage } from '../src/renderer.js';

interface Capture {
  io: { out(s: string): void; err(s: string): void };
  out: string[];
  err: string[];
}

function capture(): Capture {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (s) => out.push(s), err: (s) => err.push(s) }, out, err };
}

const outText = (c: Capture) => c.out.join('');
const errText = (c: Capture) => c.err.join('');
const json = <T = any>(c: Capture): T => JSON.parse(outText(c)) as T;

let dir: string;
let originalCwd: string;

function writeConfig(paths: Record<string, string> = {}) {
  writeFileSync(
    join(dir, 'engine.config.yaml'),
    'project:\n  name: "T"\n  lang: "en"\n' +
      `paths:\n  components: "${paths.components ?? 'components'}"\n  pages: "${paths.pages ?? 'pages'}"\n  data: "${paths.data ?? 'data'}"\n  assets: "assets"\n  build: "build"\n` +
      'build:\n  inlineCSS: false\nvalidation:\n  strict: false\n  requireAltText: true\n',
  );
}

function component(name: string, opts: { template?: string; schema?: string } = {}) {
  const template = opts.template ?? '<h2>{{text:heading}}</h2>';
  const schema = opts.schema ?? '{"heading":{"type":"text","required":true}}';
  writeFileSync(join(dir, 'components', `${name}.component.html`), `${template}\n---\n\n---\n${schema}\n`);
}

function page(name: string, components: string[]) {
  writeFileSync(
    join(dir, 'pages', `${name}.page.yaml`),
    `title: "${name}"\ndescription: "d"\ncomponents:\n${components.map((c) => `  - ${c}`).join('\n')}\n`,
  );
}

beforeEach(() => {
  originalCwd = process.cwd();
  dir = mkdtempSync(join(tmpdir(), 'htmlng-pc-'));
  mkdirSync(join(dir, 'components'));
  mkdirSync(join(dir, 'pages'));
  writeFileSync(join(dir, 'global.css'), 'body { margin: 0; }\n');
  writeFileSync(join(dir, 'design-tokens.yaml'), 'primary: "#0066cc"\n');
  writeConfig();
  process.chdir(dir);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(dir, { recursive: true, force: true });
});

describe('--json contract', () => {
  it('stamps schemaVersion on success payloads', async () => {
    component('sec');
    page('index', ['sec']);
    mkdirSync(join(dir, 'data', 'index'), { recursive: true });
    writeFileSync(join(dir, 'data', 'index', 'sec.yaml'), 'heading: "Hi"\n');

    const c = capture();
    expect(await run(['--json', 'validate'], c.io)).toBe(0);
    expect(json(c).schemaVersion).toBe(JSON_SCHEMA_VERSION);
  });

  it('stamps schemaVersion on error payloads', async () => {
    const c = capture();
    expect(await run(['--json', 'bogus'], c.io)).toBe(1);
    expect(json(c).schemaVersion).toBe(JSON_SCHEMA_VERSION);
  });
});

describe('array data ids', () => {
  it('indexes a single-element array as <name>-0', async () => {
    component('sec');
    page('index', ['sec']);
    mkdirSync(join(dir, 'data', 'index'), { recursive: true });
    writeFileSync(join(dir, 'data', 'index', 'sec.yaml'), '- heading: "only"\n');

    const c = capture();
    expect(await run(['render', 'page', 'index', '--compact'], c.io)).toBe(0);
    expect(outText(c)).toContain('id="sec-0"');
  });

  it('indexes a multi-element array in order', async () => {
    component('sec');
    page('index', ['sec']);
    mkdirSync(join(dir, 'data', 'index'), { recursive: true });
    writeFileSync(join(dir, 'data', 'index', 'sec.yaml'), '- heading: "a"\n- heading: "b"\n');

    const html = renderPage(dir, 'index');
    expect(html).toContain('id="sec-0"');
    expect(html).toContain('id="sec-1"');
  });
});

describe('custom paths.data', () => {
  it('loads data from the configured directory', () => {
    writeConfig({ data: 'content' });
    component('sec');
    page('index', ['sec']);
    mkdirSync(join(dir, 'content', 'index'), { recursive: true });
    writeFileSync(join(dir, 'content', 'index', 'sec.yaml'), 'heading: "from content"\n');

    const loaded = loadData(dir, 'index', 'sec');
    expect(loaded).toEqual({ heading: 'from content' });
    expect(renderPage(dir, 'index')).toContain('<h2>from content</h2>');
  });

  it('honors custom component and page directories too', () => {
    writeConfig({ components: 'widgets', pages: 'routes' });
    mkdirSync(join(dir, 'widgets'), { recursive: true });
    writeFileSync(join(dir, 'widgets', 'sec.component.html'), '<h2>{{text:heading}}</h2>\n---\n\n---\n{"heading":{"type":"text"}}\n');
    mkdirSync(join(dir, 'routes'), { recursive: true });
    writeFileSync(join(dir, 'routes', 'index.page.yaml'), 'title: "I"\ndescription: "d"\ncomponents:\n  - sec\n');
    mkdirSync(join(dir, 'data', 'index'), { recursive: true });
    writeFileSync(join(dir, 'data', 'index', 'sec.yaml'), 'heading: "custom dirs"\n');

    expect(renderPage(dir, 'index')).toContain('<h2>custom dirs</h2>');
  });
});

describe('redundant wrapper warning', () => {
  it('warns when a template duplicates the engine wrapper', async () => {
    component('box', {
      template: '<div class="box"><h2>{{text:heading}}</h2></div>',
      schema: '{"heading":{"type":"text"}}',
    });
    page('index', ['box']);
    mkdirSync(join(dir, 'data', 'index'), { recursive: true });
    writeFileSync(join(dir, 'data', 'index', 'box.yaml'), 'heading: "Hi"\n');

    const c = capture();
    expect(await run(['--json', 'validate', 'component', 'box'], c.io)).toBe(0);
    const codes = json(c).warnings.map((w: { code: string }) => w.code);
    expect(codes).toContain('COMPONENT_REDUNDANT_WRAPPER');
    expect(errText(c)).toBe('');
  });

  it('explains the new code', async () => {
    const c = capture();
    expect(await run(['explain', 'COMPONENT_REDUNDANT_WRAPPER'], c.io)).toBe(0);
    expect(outText(c)).toContain('Remove the outer div');
  });
});
