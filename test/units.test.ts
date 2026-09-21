import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../src/config.js';
import { parsePage, findPages } from '../src/page.js';
import { loadData } from '../src/data-file.js';
import { affectedPages } from '../src/propagation.js';
import { copyAssets } from '../src/copier.js';
import { unsafeUrlReason } from '../src/url-safety.js';
import { initProject, scaffoldData } from '../src/scaffold.js';
import { renderPage, renderComponent } from '../src/renderer.js';
import { EngineError } from '../src/types.js';

let dir: string;
let originalCwd: string;

function codeOf(fn: () => unknown): string | undefined {
  try { fn(); return undefined; }
  catch (e) { return e instanceof EngineError ? e.code : `NOT_ENGINE:${(e as Error).message}`; }
}

function component(name: string, opts: { template?: string; schema?: string } = {}) {
  const template = opts.template ?? '<h2>{{text:heading}}</h2>';
  const schema = opts.schema ?? '{"heading":{"type":"text","required":true}}';
  writeFileSync(join(dir, 'components', `${name}.component.html`), `${template}\n---\n\n---\n${schema}\n`);
}

function page(name: string, components: string[]) {
  writeFileSync(join(dir, 'pages', `${name}.page.yaml`), `title: "${name}"\ndescription: "d"\ncomponents:\n${components.map((c) => `  - ${c}`).join('\n')}\n`);
}

function data(pageName: string, comp: string, yaml: string) {
  mkdirSync(join(dir, 'data', pageName), { recursive: true });
  writeFileSync(join(dir, 'data', pageName, `${comp}.yaml`), yaml);
}

function baseConfig(extra = '') {
  writeFileSync(join(dir, 'engine.config.yaml'),
    'project:\n  name: "T"\n  lang: "en"\n' +
    'paths:\n  components: "components"\n  pages: "pages"\n  data: "data"\n  assets: "assets"\n  build: "build"\n' +
    extra);
}

beforeEach(() => {
  originalCwd = process.cwd();
  dir = mkdtempSync(join(tmpdir(), 'htmlng-units-'));
  mkdirSync(join(dir, 'components'));
  mkdirSync(join(dir, 'pages'));
  writeFileSync(join(dir, 'global.css'), 'body { margin: 0; }\n');
  writeFileSync(join(dir, 'design-tokens.yaml'), 'primary: "#000"\n');
  baseConfig();
  process.chdir(dir);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(dir, { recursive: true, force: true });
});

describe('config', () => {
  it('applies defaults for missing sections', () => {
    writeFileSync(join(dir, 'engine.config.yaml'), 'project:\n  name: "Only name"\n');
    const cfg = loadConfig(dir);
    expect(cfg.project.lang).toBe('en');
    expect(cfg.paths.components).toBe('components');
    expect(cfg.build.inlineCSS).toBe(false);
    expect(cfg.validation.requireAltText).toBe(true);
    expect(cfg.validation.strict).toBe(false);
  });

  it('parses inlineCSS, strict, and requireAltText', () => {
    baseConfig('build:\n  inlineCSS: true\nvalidation:\n  strict: true\n  requireAltText: false\n');
    const cfg = loadConfig(dir);
    expect(cfg.build.inlineCSS).toBe(true);
    expect(cfg.validation.strict).toBe(true);
    expect(cfg.validation.requireAltText).toBe(false);
  });

  it('rejects path traversal in paths.*', () => {
    writeFileSync(join(dir, 'engine.config.yaml'), 'paths:\n  data: "../secrets"\n');
    expect(codeOf(() => loadConfig(dir))).toBe('CONFIG_PATH_TRAVERSAL');
  });

  it('reports a missing config file', () => {
    rmSync(join(dir, 'engine.config.yaml'));
    expect(codeOf(() => loadConfig(dir))).toBe('CONFIG_LOAD');
  });
});

describe('page', () => {
  it('reports missing required fields with codes', () => {
    writeFileSync(join(dir, 'pages', 'x.page.yaml'), 'description: "d"\ncomponents: []\n');
    expect(codeOf(() => parsePage(join(dir, 'pages', 'x.page.yaml')))).toBe('PAGE_TITLE_INVALID');

    writeFileSync(join(dir, 'pages', 'x.page.yaml'), 'title: "t"\ncomponents: []\n');
    expect(codeOf(() => parsePage(join(dir, 'pages', 'x.page.yaml')))).toBe('PAGE_DESCRIPTION_INVALID');

    writeFileSync(join(dir, 'pages', 'x.page.yaml'), 'title: "t"\ndescription: "d"\n');
    expect(codeOf(() => parsePage(join(dir, 'pages', 'x.page.yaml')))).toBe('PAGE_COMPONENTS_INVALID');
  });

  it('reports a missing page file', () => {
    expect(codeOf(() => parsePage(join(dir, 'pages', 'nope.page.yaml')))).toBe('PAGE_NOT_FOUND');
  });

  it('lists pages by base name', () => {
    page('index', ['a']);
    page('about', ['a']);
    expect(findPages(join(dir, 'pages')).sort()).toEqual(['about', 'index']);
  });
});

describe('data-file', () => {
  it('returns an empty object when the file is missing', () => {
    expect(loadData(dir, 'index', 'missing')).toEqual({});
  });

  it('returns an object for a map root and an array for a sequence root', () => {
    data('index', 'one', 'heading: "x"\n');
    data('index', 'many', '- heading: "a"\n- heading: "b"\n');
    expect(loadData(dir, 'index', 'one')).toEqual({ heading: 'x' });
    expect(Array.isArray(loadData(dir, 'index', 'many'))).toBe(true);
    expect(loadData(dir, 'index', 'many')).toHaveLength(2);
  });

  it('rejects a scalar root', () => {
    data('index', 'bad', 'just a string\n');
    expect(codeOf(() => loadData(dir, 'index', 'bad'))).toBe('DATA_ROOT_INVALID');
  });

  it('rejects an array element that is not an object', () => {
    data('index', 'bad', '- one\n- two\n');
    expect(codeOf(() => loadData(dir, 'index', 'bad'))).toBe('DATA_ARRAY_ITEM_INVALID');
  });
});

describe('propagation', () => {
  beforeEach(() => {
    component('a');
    component('b');
    page('index', ['a', 'b']);
    page('about', ['a']);
  });

  it('maps global.css to every page', () => {
    expect(affectedPages(dir, 'global.css').sort()).toEqual(['about', 'index']);
  });

  it('maps a component to the pages that use it', () => {
    expect(affectedPages(dir, 'components/b.component.html')).toEqual(['index']);
    expect(affectedPages(dir, 'components/a.component.html').sort()).toEqual(['about', 'index']);
  });

  it('maps a data file and a page file to that page', () => {
    expect(affectedPages(dir, 'data/index/a.yaml')).toEqual(['index']);
    expect(affectedPages(dir, 'pages/about.page.yaml')).toEqual(['about']);
  });

  it('maps unknown paths to nothing', () => {
    expect(affectedPages(dir, 'notes.txt')).toEqual([]);
  });
});

describe('copier', () => {
  it('copies assets into build/assets', () => {
    mkdirSync(join(dir, 'assets', 'images'), { recursive: true });
    writeFileSync(join(dir, 'assets', 'images', 'logo.svg'), '<svg/>');
    copyAssets(dir);
    expect(existsSync(join(dir, 'build', 'assets', 'images', 'logo.svg'))).toBe(true);
  });

  it('is a no-op when there is no assets directory', () => {
    expect(() => copyAssets(dir)).not.toThrow();
    expect(existsSync(join(dir, 'build', 'assets'))).toBe(false);
  });
});

describe('url safety', () => {
  it('rejects dangerous schemes, including obfuscated ones', () => {
    expect(unsafeUrlReason('javascript:alert(1)')).toMatch(/not allowed/);
    expect(unsafeUrlReason('JavaScript:alert(1)')).toMatch(/not allowed/);
    expect(unsafeUrlReason('java\tscript:alert(1)')).toMatch(/not allowed/);
    expect(unsafeUrlReason('  vbscript:msgbox(1)')).toMatch(/not allowed/);
    expect(unsafeUrlReason('file:///etc/passwd')).toMatch(/not allowed/);
  });

  it('allows relative, fragment, and safe schemes', () => {
    for (const ok of ['#features', '/about', 'about.html', 'https://example.com/x', 'mailto:a@b.c', 'tel:+123']) {
      expect(unsafeUrlReason(ok), ok).toBeNull();
    }
  });

  it('gates data: URLs and blocks SVG', () => {
    expect(unsafeUrlReason('data:image/png;base64,AAAA')).toMatch(/not allowed/);
    expect(unsafeUrlReason('data:image/png;base64,AAAA', { allowDataImage: true })).toBeNull();
    expect(unsafeUrlReason('data:image/svg+xml;base64,AAAA', { allowDataImage: true })).toMatch(/SVG/);
    expect(unsafeUrlReason('data:text/html,<script>', { allowDataImage: true })).toMatch(/raster/);
  });
});

describe('scaffold', () => {
  it('init creates assets/ and a config without the removed keys', () => {
    const fresh = mkdtempSync(join(tmpdir(), 'htmlng-init-'));
    try {
      initProject(fresh, 'Demo');
      expect(existsSync(join(fresh, 'assets'))).toBe(true);
      const cfg = readFileSync(join(fresh, 'engine.config.yaml'), 'utf-8');
      expect(cfg).toContain('inlineCSS');
      expect(cfg).not.toContain('minify');
      expect(cfg).not.toContain('assetFingerprinting');
      expect(cfg).not.toContain('maxHeadingLength');
    } finally {
      rmSync(fresh, { recursive: true, force: true });
    }
  });

  it('scaffolds a slot data shape', () => {
    component('host', { template: '{{slot:child}}', schema: '{"child":{"type":"slot"}}' });
    scaffoldData(dir, 'index', 'host');
    const yaml = readFileSync(join(dir, 'data', 'index', 'host.yaml'), 'utf-8');
    expect(yaml).toContain('component: ""');
    expect(yaml).not.toContain('src: null');
  });
});

describe('security integration', () => {
  it('rejects a javascript: link href', () => {
    component('cta', { template: '{{link:action}}', schema: '{"action":{"type":"link"}}' });
    page('index', ['cta']);
    data('index', 'cta', 'action:\n  href: "javascript:alert(1)"\n  label: "x"\n');
    expect(codeOf(() => renderPage(dir, 'index'))).toBe('UNSAFE_URL');
  });

  it('rejects a javascript: href inside a text field', () => {
    component('note', { template: '{{text:body}}', schema: '{"body":{"type":"text"}}' });
    page('index', ['note']);
    data('index', 'note', 'body: \'<a href="javascript:alert(1)">x</a>\'\n');
    expect(codeOf(() => renderPage(dir, 'index'))).toBe('UNSAFE_URL');
  });

  it('allows safe links', () => {
    component('cta', { template: '{{link:action}}', schema: '{"action":{"type":"link"}}' });
    page('index', ['cta']);
    data('index', 'cta', 'action:\n  href: "https://example.com"\n  label: "x"\n');
    expect(renderPage(dir, 'index')).toContain('href="https://example.com"');
  });

  it('validates slot sub-data against the nested schema', () => {
    component('card', { template: '{{text:title}}', schema: '{"title":{"type":"text","required":true}}' });
    component('host', { template: '{{slot:child}}', schema: '{"child":{"type":"slot"}}' });
    page('index', ['host']);
    data('index', 'host', 'child:\n  component: card\n  data:\n    wrong_key: "x"\n');
    expect(codeOf(() => renderPage(dir, 'index'))).toBe('SCHEMA_VALIDATION');
  });

  it('rejects a circular slot chain in data', () => {
    component('a', { template: '{{slot:next}}', schema: '{"next":{"type":"slot"}}' });
    component('host', { template: '{{slot:child}}', schema: '{"child":{"type":"slot"}}' });
    page('index', ['host']);
    data('index', 'host', 'child:\n  component: a\n  data:\n    next:\n      component: a\n      data: {}\n');
    expect(codeOf(() => renderPage(dir, 'index'))).toBe('SLOT_CIRCULAR');
  });

  it('rejects slot data that is not an object', () => {
    component('card', { template: '{{text:title}}', schema: '{"title":{"type":"text"}}' });
    component('host', { template: '{{slot:child}}', schema: '{"child":{"type":"slot"}}' });
    page('index', ['host']);
    data('index', 'host', 'child:\n  component: card\n  data: "nope"\n');
    expect(codeOf(() => renderPage(dir, 'index'))).toBe('SCHEMA_VALIDATION');
  });

  it('validates slot sub-data in render component too', () => {
    component('card', { template: '{{text:title}}', schema: '{"title":{"type":"text","required":true}}' });
    component('host', { template: '{{slot:child}}', schema: '{"child":{"type":"slot"}}' });
    page('index', ['host']);
    data('index', 'host', 'child:\n  component: card\n  data: {}\n');
    expect(codeOf(() => renderComponent(dir, 'host', 'index'))).toBe('SCHEMA_VALIDATION');
  });
});
