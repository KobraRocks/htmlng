import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { run } from '../src/cli.js';
import { isStale } from '../src/hasher.js';

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

function writeConfig(opts: { strict?: boolean; requireAltText?: boolean; inlineCSS?: boolean } = {}) {
  writeFileSync(
    join(dir, 'engine.config.yaml'),
    'project:\n  name: "T"\n  lang: "en"\n' +
      'paths:\n  components: "components"\n  pages: "pages"\n  data: "data"\n  assets: "assets"\n  build: "build"\n' +
      `build:\n  inlineCSS: ${opts.inlineCSS ?? false}\n` +
      `validation:\n  strict: ${opts.strict ?? false}\n  requireAltText: ${opts.requireAltText ?? false}\n`,
  );
}

function component(name: string, opts: { template?: string; css?: string; schema?: string } = {}) {
  const template = opts.template ?? '<h2>{{text:heading}}</h2>';
  const css = opts.css ?? '';
  const schema = opts.schema ?? '{"heading":{"type":"text","required":true}}';
  writeFileSync(join(dir, 'components', `${name}.component.html`), `${template}\n---\n${css}\n---\n${schema}\n`);
}

function page(name: string, components: string[]) {
  writeFileSync(
    join(dir, 'pages', `${name}.page.yaml`),
    `title: "${name}"\ndescription: "d"\ncomponents:\n${components.map((c) => `  - ${c}`).join('\n')}\n`,
  );
}

function data(pageName: string, comp: string, yaml: string) {
  mkdirSync(join(dir, 'data', pageName), { recursive: true });
  writeFileSync(join(dir, 'data', pageName, `${comp}.yaml`), yaml);
}

beforeEach(() => {
  originalCwd = process.cwd();
  dir = mkdtempSync(join(tmpdir(), 'htmlng-pb-'));
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

describe('--json validate', () => {
  it('emits structured errors with stable codes and returns 1', async () => {
    component('sec');
    page('index', ['sec']);
    data('index', 'sec', 'heading: 123\n');

    const c = capture();
    expect(await run(['--json', 'validate'], c.io)).toBe(1);
    const result = json(c);
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe('SCHEMA_VALIDATION');
    expect(result.errors[0].file).toContain('sec.yaml');
    expect(result.errors[0].message).toContain('must be string');
  });

  it('emits ok:true with no errors on a clean project', async () => {
    component('sec');
    page('index', ['sec']);
    data('index', 'sec', 'heading: "Hi"\n');

    const c = capture();
    expect(await run(['--json', 'validate'], c.io)).toBe(0);
    const result = json(c);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('includes warning codes without failing', async () => {
    component('sec', { template: '<p>{{text:used}}</p>', schema: '{"used":{"type":"text"},"unused_field":{"type":"text"}}' });
    page('index', ['sec']);
    data('index', 'sec', 'used: "hi"\nstray_key: "x"\n');

    const c = capture();
    expect(await run(['--json', 'validate'], c.io)).toBe(0);
    const codes = json(c).warnings.map((w: { code: string }) => w.code);
    expect(codes).toContain('SCHEMA_FIELD_UNUSED');
    expect(codes).toContain('DATA_KEY_UNUSED');
  });
});

describe('--json build and render', () => {
  it('emits a page list for build', async () => {
    component('sec');
    page('index', ['sec']);
    data('index', 'sec', 'heading: "A"\n');

    const c = capture();
    expect(await run(['--json', 'build'], c.io)).toBe(0);
    const result = json(c);
    expect(result.ok).toBe(true);
    expect(result.pages).toEqual(['index']);
    expect(existsSync(join(dir, 'build', 'index.html'))).toBe(true);
  });

  it('emits html and metadata for render page', async () => {
    component('sec');
    page('index', ['sec']);
    data('index', 'sec', 'heading: "A"\n');

    const c = capture();
    expect(await run(['--json', 'render', 'page', 'index'], c.io)).toBe(0);
    const result = json(c);
    expect(result.page).toBe('index');
    expect(result.components).toEqual(['sec']);
    expect(result.html).toContain('<h2>A</h2>');
  });

  it('emits a JSON error object when a command throws', async () => {
    page('index', ['ghost']);
    const c = capture();
    expect(await run(['--json', 'render', 'page', 'index'], c.io)).toBe(1);
    const result = json(c);
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe('COMPONENT_NOT_FOUND');
  });

  it('emits a JSON error for an unknown command', async () => {
    const c = capture();
    expect(await run(['--json', 'bogus'], c.io)).toBe(1);
    expect(json(c).errors[0].code).toBe('CLI_UNKNOWN_COMMAND');
  });
});

describe('warnings and strict mode', () => {
  function warnProject() {
    component('warn', { template: '<p>{{text:used}}</p>', schema: '{"used":{"type":"text"},"unused_field":{"type":"text"}}' });
    page('index', ['warn']);
    data('index', 'warn', 'used: "hi"\nstray_key: "x"\n');
  }

  it('surfaces warnings during render but still succeeds', async () => {
    warnProject();
    const c = capture();
    expect(await run(['render', 'page', 'index', '--compact'], c.io)).toBe(0);
    expect(errText(c)).toContain('WARNING');
    expect(errText(c)).toContain('unused_field');
  });

  it('fails under --strict when warnings exist', async () => {
    warnProject();
    const c = capture();
    expect(await run(['--strict', 'render', 'page', 'index', '--compact'], c.io)).toBe(1);
  });

  it('honors validation.strict from the config file', async () => {
    writeConfig({ strict: true });
    warnProject();
    const c = capture();
    expect(await run(['build'], c.io)).toBe(1);
  });
});

describe('context command', () => {
  it('reports pages, components, data shapes, and staleness', async () => {
    component('host', {
      template: '<h2>{{text:heading}}</h2>{{#list:items}}<li>{{text:label}}</li>{{/list:items}}',
      schema: '{"heading":{"type":"text"},"items":{"type":"list"}}',
    });
    component('card');
    page('index', ['host']);
    data('index', 'host', '- heading: "H1"\n  items:\n    - label: one\n- heading: "H2"\n  items:\n    - label: two\n');

    const c = capture();
    expect(await run(['context'], c.io)).toBe(0);
    const ctx = json(c);
    expect(ctx.ok).toBe(true);
    expect(ctx.components.map((x: { name: string }) => x.name).sort()).toEqual(['card', 'host']);
    expect(ctx.pages[0].components[0]).toMatchObject({ name: 'host', dataShape: 'array', itemCount: 2 });
    expect(typeof ctx.pages[0].stale).toBe('boolean');
    expect(ctx.tokens.primary).toBe('#0066cc');
  });
});

describe('schema command', () => {
  it('emits the format spec', async () => {
    const c = capture();
    expect(await run(['schema'], c.io)).toBe(0);
    const spec = json(c);
    expect(spec.version).toBe(1);
    expect(spec.placeholderTypes.map((p: { type: string }) => p.type))
      .toEqual(['text', 'html', 'image', 'link', 'list', 'bool', 'if', 'unless', 'slot']);
    expect(spec.componentFile.sections.map((s: { name: string }) => s.name)).toEqual(['template', 'css', 'schema']);
  });
});

describe('explain command', () => {
  it('explains a known code', async () => {
    const c = capture();
    expect(await run(['--json', 'explain', 'SCHEMA_VALIDATION'], c.io)).toBe(0);
    const result = json(c);
    expect(result.code).toBe('SCHEMA_VALIDATION');
    expect(result.fix).toBeTruthy();
  });

  it('lists every code when given none', async () => {
    const c = capture();
    expect(await run(['--json', 'explain'], c.io)).toBe(0);
    expect(json(c).codes.length).toBeGreaterThan(20);
  });

  it('returns 1 for an unknown code', async () => {
    const c = capture();
    expect(await run(['explain', 'NOT_A_CODE'], c.io)).toBe(1);
    expect(errText(c)).toContain('Unknown error code');
  });
});

describe('create data scaffolds valid shapes', () => {
  it('emits correct slot and list stubs derived from the template', async () => {
    component('host', {
      template: '<h2>{{text:heading}}</h2>{{#list:items}}<li>{{text:icon}} {{text:label}}</li>{{/list:items}}{{slot:child}}{{image:pic}}',
      schema: '{"heading":{"type":"text"},"items":{"type":"list"},"child":{"type":"slot"},"pic":{"type":"image"}}',
    });
    page('index', ['host']);

    const c = capture();
    expect(await run(['create', 'data', 'host', '--page', 'index'], c.io)).toBe(0);
    const yaml = readFileSync(join(dir, 'data', 'index', 'host.yaml'), 'utf-8');

    expect(yaml).toContain('component: ""');
    expect(yaml).not.toContain('src: null');
    expect(yaml).toContain('icon: ""');
    expect(yaml).toContain('label: ""');
    expect(yaml).toContain('src: ""');
    expect(yaml).toContain('alt: ""');
  });
});

describe('slots resolve to sibling components', () => {
  it('renders a slot in render component', async () => {
    component('card', { template: '<div class="card">{{text:title}}</div>', schema: '{"title":{"type":"text"}}' });
    component('host', { template: '{{slot:child}}', schema: '{"child":{"type":"slot"}}' });
    page('index', ['host']);
    data('index', 'host', 'child:\n  component: card\n  data:\n    title: "Nested"\n');

    const c = capture();
    expect(await run(['render', 'component', 'host', '--page', 'index'], c.io)).toBe(0);
    expect(outText(c)).toContain('<div class="card">Nested</div>');
  });
});

describe('requireAltText', () => {
  function imageProject() {
    component('img', { template: '{{image:pic}}', schema: '{"pic":{"type":"image"}}' });
    page('index', ['img']);
  }

  it('fails when alt is absent and the config requires it', async () => {
    writeConfig({ requireAltText: true });
    imageProject();
    data('index', 'img', 'pic:\n  src: "a.webp"\n');

    const c = capture();
    expect(await run(['render', 'page', 'index', '--compact'], c.io)).toBe(1);
    expect(errText(c)).toContain("Image \"pic\" is missing alt text");
  });

  it('accepts an empty alt string (decorative image)', async () => {
    writeConfig({ requireAltText: true });
    imageProject();
    data('index', 'img', 'pic:\n  src: "a.webp"\n  alt: ""\n');

    const c = capture();
    expect(await run(['render', 'page', 'index', '--compact'], c.io)).toBe(0);
  });

  it('skips the check when disabled', async () => {
    writeConfig({ requireAltText: false });
    imageProject();
    data('index', 'img', 'pic:\n  src: "a.webp"\n');

    const c = capture();
    expect(await run(['render', 'page', 'index', '--compact'], c.io)).toBe(0);
  });
});

describe('cache tracks design tokens and config', () => {
  it('marks a page stale after design-tokens.yaml changes', async () => {
    component('sec');
    page('index', ['sec']);
    data('index', 'sec', 'heading: "A"\n');

    expect(await run(['build'], capture().io)).toBe(0);
    expect(isStale(dir, 'index')).toBe(false);

    writeFileSync(join(dir, 'design-tokens.yaml'), 'primary: "#ff0000"\n');
    expect(isStale(dir, 'index')).toBe(true);
  });
});
