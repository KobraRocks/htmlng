import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../src/config.js';
import { parsePage, findPages, comparePageNames } from '../src/page.js';
import { loadData, findOrphanDataFiles } from '../src/data-file.js';
import { affectedPages } from '../src/propagation.js';
import { copyAssets } from '../src/copier.js';
import { unsafeUrlReason } from '../src/url-safety.js';
import { initProject, scaffoldData } from '../src/scaffold.js';
import { renderPage, renderComponent } from '../src/renderer.js';
import { EngineError } from '../src/types.js';
import { createProject, type FixtureProject } from './helpers/fixture.js';

let dir: string;
let project: FixtureProject;
let originalCwd: string;

function codeOf(fn: () => unknown): string | undefined {
  try { fn(); return undefined; }
  catch (e) { return e instanceof EngineError ? e.code : `NOT_ENGINE:${(e as Error).message}`; }
}

function baseConfig(extra = '') {
  writeFileSync(join(dir, 'engine.config.yaml'),
    'project:\n  name: "T"\n  lang: "en"\n' +
    'paths:\n  components: "components"\n  pages: "pages"\n  data: "data"\n  assets: "assets"\n  build: "build"\n' +
    extra);
}

beforeEach(() => {
  originalCwd = process.cwd();
  project = createProject({ prefix: 'htmlng-units-' });
  dir = project.dir;
  process.chdir(dir);
});

afterEach(() => {
  process.chdir(originalCwd);
  project.remove();
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
    project.page('index', ['a']);
    project.page('about', ['a']);
    expect(findPages(join(dir, 'pages')).sort()).toEqual(['about', 'index']);
  });

  it('orders numeric page names naturally, not lexicographically', () => {
    for (const name of ['slide-1', 'slide-2', 'slide-10', 'slide-3']) project.page(name, ['a']);
    expect(findPages(join(dir, 'pages'))).toEqual(['slide-1', 'slide-2', 'slide-3', 'slide-10']);
  });

  it('compares page names by numeric runs and code units', () => {
    expect(comparePageNames('slide-2', 'slide-10')).toBeLessThan(0);
    expect(comparePageNames('slide-10', 'slide-2')).toBeGreaterThan(0);
    expect(comparePageNames('slide-1', 'slide-1')).toBe(0);
    expect(comparePageNames('a', 'a1')).toBeLessThan(0);
    expect(comparePageNames('A', 'a')).toBeLessThan(0);
  });

  it('is a total order even when numeric chunks tie', () => {
    const names = ['slide-07', 'slide-7', 'slide-007'];
    const sorted = [...names].sort(comparePageNames);
    expect(sorted).toEqual(['slide-007', 'slide-07', 'slide-7']);
    expect([...names].reverse().sort(comparePageNames)).toEqual(sorted);
    // Integers beyond Number.MAX_SAFE_INTEGER still order deterministically.
    expect(comparePageNames('slide-9007199254740993', 'slide-9007199254740992')).toBeGreaterThan(0);
    expect(comparePageNames('', 'a')).toBeLessThan(0);
  });

  it('reads the optional layout block', () => {
    writeFileSync(join(dir, 'pages', 'deck.page.yaml'),
      'title: "t"\ndescription: "d"\ncomponents: []\nlayout:\n  wrapper: true\n  bodyClass: "deck"\n');
    expect(parsePage(join(dir, 'pages', 'deck.page.yaml')).layout).toEqual({ wrapper: true, bodyClass: 'deck' });
  });

  it('leaves layout undefined when the page omits it', () => {
    project.page('plain', ['a']);
    expect(parsePage(join(dir, 'pages', 'plain.page.yaml')).layout).toBeUndefined();
  });

  it('rejects a non-boolean layout.wrapper', () => {
    writeFileSync(join(dir, 'pages', 'bad.page.yaml'),
      'title: "t"\ndescription: "d"\ncomponents: []\nlayout:\n  wrapper: "yes"\n');
    expect(codeOf(() => parsePage(join(dir, 'pages', 'bad.page.yaml')))).toBe('PAGE_LAYOUT_INVALID');
  });

  it('rejects a non-string layout.bodyClass', () => {
    writeFileSync(join(dir, 'pages', 'bad.page.yaml'),
      'title: "t"\ndescription: "d"\ncomponents: []\nlayout:\n  bodyClass: 7\n');
    expect(codeOf(() => parsePage(join(dir, 'pages', 'bad.page.yaml')))).toBe('PAGE_LAYOUT_INVALID');
  });
});

describe('data-file', () => {
  it('returns an empty object when the file is missing', () => {
    expect(loadData(dir, 'index', 'missing')).toEqual({});
  });

  it('returns an object for a map root and an array for a sequence root', () => {
    project.data('index', 'one', 'heading: "x"\n');
    project.data('index', 'many', '- heading: "a"\n- heading: "b"\n');
    expect(loadData(dir, 'index', 'one')).toEqual({ heading: 'x' });
    expect(Array.isArray(loadData(dir, 'index', 'many'))).toBe(true);
    expect(loadData(dir, 'index', 'many')).toHaveLength(2);
  });

  it('rejects a scalar root', () => {
    project.data('index', 'bad', 'just a string\n');
    expect(codeOf(() => loadData(dir, 'index', 'bad'))).toBe('DATA_ROOT_INVALID');
  });

  it('rejects an array element that is not an object', () => {
    project.data('index', 'bad', '- one\n- two\n');
    expect(codeOf(() => loadData(dir, 'index', 'bad'))).toBe('DATA_ARRAY_ITEM_INVALID');
  });

  it('reports orphan data files with their resolved paths', () => {
    project.data('index', 'used', 'heading: "x"\n');
    project.data('index', 'stale', 'heading: "y"\n');
    writeFileSync(join(dir, 'data', 'index', 'notes.txt'), 'ignored\n');
    const config = loadConfig(dir);
    expect(findOrphanDataFiles(dir, config, 'index', ['used'])).toEqual([
      { component: 'stale', file: join(dir, 'data', 'index', 'stale.yaml') },
    ]);
    expect(findOrphanDataFiles(dir, config, 'index', ['used', 'stale'])).toEqual([]);
  });

  it('locates orphan data files under a custom data directory', () => {
    project.configure({ paths: { data: 'content' } });
    project.data('index', 'stale', 'heading: "x"\n');
    expect(findOrphanDataFiles(dir, loadConfig(dir), 'index', [])).toEqual([
      { component: 'stale', file: join(dir, 'content', 'index', 'stale.yaml') },
    ]);
  });

  it('reports no orphans when the data directory is missing', () => {
    expect(findOrphanDataFiles(dir, loadConfig(dir), 'nope', ['used'])).toEqual([]);
  });
});

describe('propagation', () => {
  beforeEach(() => {
    project.component('a');
    project.component('b');
    project.page('index', ['a', 'b']);
    project.page('about', ['a']);
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
    project.component('host', { template: '{{slot:child}}', schema: '{"child":{"type":"slot"}}' });
    scaffoldData(dir, 'index', 'host');
    const yaml = readFileSync(join(dir, 'data', 'index', 'host.yaml'), 'utf-8');
    expect(yaml).toContain('component: ""');
    expect(yaml).not.toContain('src: null');
  });
});

describe('security integration', () => {
  it('rejects a javascript: link href', () => {
    project.component('cta', { template: '{{link:action}}', schema: '{"action":{"type":"link"}}' });
    project.page('index', ['cta']);
    project.data('index', 'cta', 'action:\n  href: "javascript:alert(1)"\n  label: "x"\n');
    expect(codeOf(() => renderPage(dir, 'index'))).toBe('UNSAFE_URL');
  });

  it('rejects a javascript: href inside a text field', () => {
    project.component('note', { template: '{{text:body}}', schema: '{"body":{"type":"text"}}' });
    project.page('index', ['note']);
    project.data('index', 'note', 'body: \'<a href="javascript:alert(1)">x</a>\'\n');
    expect(codeOf(() => renderPage(dir, 'index'))).toBe('UNSAFE_URL');
  });

  it('allows safe links', () => {
    project.component('cta', { template: '{{link:action}}', schema: '{"action":{"type":"link"}}' });
    project.page('index', ['cta']);
    project.data('index', 'cta', 'action:\n  href: "https://example.com"\n  label: "x"\n');
    expect(renderPage(dir, 'index')).toContain('href="https://example.com"');
  });

  it('validates slot sub-data against the nested schema', () => {
    project.component('card', { template: '{{text:title}}', schema: '{"title":{"type":"text","required":true}}' });
    project.component('host', { template: '{{slot:child}}', schema: '{"child":{"type":"slot"}}' });
    project.page('index', ['host']);
    project.data('index', 'host', 'child:\n  component: card\n  data:\n    wrong_key: "x"\n');
    expect(codeOf(() => renderPage(dir, 'index'))).toBe('SCHEMA_VALIDATION');
  });

  it('rejects a circular slot chain in data', () => {
    project.component('a', { template: '{{slot:next}}', schema: '{"next":{"type":"slot"}}' });
    project.component('host', { template: '{{slot:child}}', schema: '{"child":{"type":"slot"}}' });
    project.page('index', ['host']);
    project.data('index', 'host', 'child:\n  component: a\n  data:\n    next:\n      component: a\n      data: {}\n');
    expect(codeOf(() => renderPage(dir, 'index'))).toBe('SLOT_CIRCULAR');
  });

  it('rejects slot data that is not an object', () => {
    project.component('card', { template: '{{text:title}}', schema: '{"title":{"type":"text"}}' });
    project.component('host', { template: '{{slot:child}}', schema: '{"child":{"type":"slot"}}' });
    project.page('index', ['host']);
    project.data('index', 'host', 'child:\n  component: card\n  data: "nope"\n');
    expect(codeOf(() => renderPage(dir, 'index'))).toBe('SCHEMA_VALIDATION');
  });

  it('validates slot sub-data in render component too', () => {
    project.component('card', { template: '{{text:title}}', schema: '{"title":{"type":"text","required":true}}' });
    project.component('host', { template: '{{slot:child}}', schema: '{"child":{"type":"slot"}}' });
    project.page('index', ['host']);
    project.data('index', 'host', 'child:\n  component: card\n  data: {}\n');
    expect(codeOf(() => renderComponent(dir, 'host', 'index'))).toBe('SCHEMA_VALIDATION');
  });
});
