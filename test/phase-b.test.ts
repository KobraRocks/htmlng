import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { run } from '../src/cli.js';
import { isStale } from '../src/hasher.js';
import { capture, outText, errText, jsonOut, createProject, type FixtureProject } from './helpers/fixture.js';

let dir: string;
let project: FixtureProject;
let originalCwd: string;

beforeEach(() => {
  originalCwd = process.cwd();
  project = createProject({ prefix: 'htmlng-pb-', requireAltText: false });
  dir = project.dir;
  process.chdir(dir);
});

afterEach(() => {
  process.chdir(originalCwd);
  project.remove();
});

describe('--json validate', () => {
  it('emits structured errors with stable codes and returns 1', async () => {
    project.component('sec');
    project.page('index', ['sec']);
    project.data('index', 'sec', 'heading: 123\n');

    const c = capture();
    expect(await run(['--json', 'validate'], c.io)).toBe(1);
    const result = jsonOut(c);
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe('SCHEMA_VALIDATION');
    expect(result.errors[0].file).toContain('sec.yaml');
    expect(result.errors[0].message).toContain('must be string');
  });

  it('emits ok:true with no errors on a clean project', async () => {
    project.component('sec');
    project.page('index', ['sec']);
    project.data('index', 'sec', 'heading: "Hi"\n');

    const c = capture();
    expect(await run(['--json', 'validate'], c.io)).toBe(0);
    const result = jsonOut(c);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('includes warning codes without failing', async () => {
    project.component('sec', { template: '<p>{{text:used}}</p>', schema: '{"used":{"type":"text"},"unused_field":{"type":"text"}}' });
    project.page('index', ['sec']);
    project.data('index', 'sec', 'used: "hi"\nstray_key: "x"\n');

    const c = capture();
    expect(await run(['--json', 'validate'], c.io)).toBe(0);
    const codes = jsonOut(c).warnings.map((w: { code: string }) => w.code);
    expect(codes).toContain('SCHEMA_FIELD_UNUSED');
    expect(codes).toContain('DATA_KEY_UNUSED');
  });
});

describe('--json build and render', () => {
  it('emits a page list for build', async () => {
    project.component('sec');
    project.page('index', ['sec']);
    project.data('index', 'sec', 'heading: "A"\n');

    const c = capture();
    expect(await run(['--json', 'build'], c.io)).toBe(0);
    const result = jsonOut(c);
    expect(result.ok).toBe(true);
    expect(result.pages).toEqual(['index']);
    expect(existsSync(join(dir, 'build', 'index.html'))).toBe(true);
  });

  it('emits html and metadata for render page', async () => {
    project.component('sec');
    project.page('index', ['sec']);
    project.data('index', 'sec', 'heading: "A"\n');

    const c = capture();
    expect(await run(['--json', 'render', 'page', 'index'], c.io)).toBe(0);
    const result = jsonOut(c);
    expect(result.page).toBe('index');
    expect(result.components).toEqual(['sec']);
    expect(result.html).toContain('<h2>A</h2>');
  });

  it('emits a JSON error object when a command throws', async () => {
    project.page('index', ['ghost']);
    const c = capture();
    expect(await run(['--json', 'render', 'page', 'index'], c.io)).toBe(1);
    const result = jsonOut(c);
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe('COMPONENT_NOT_FOUND');
  });

  it('emits a JSON error for an unknown command', async () => {
    const c = capture();
    expect(await run(['--json', 'bogus'], c.io)).toBe(1);
    expect(jsonOut(c).errors[0].code).toBe('CLI_UNKNOWN_COMMAND');
  });
});

describe('warnings and strict mode', () => {
  function warnProject() {
    project.component('warn', { template: '<p>{{text:used}}</p>', schema: '{"used":{"type":"text"},"unused_field":{"type":"text"}}' });
    project.page('index', ['warn']);
    project.data('index', 'warn', 'used: "hi"\nstray_key: "x"\n');
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
    project.configure({ strict: true });
    warnProject();
    const c = capture();
    expect(await run(['build'], c.io)).toBe(1);
  });
});

describe('context command', () => {
  it('reports pages, components, data shapes, and staleness', async () => {
    project.component('host', {
      template: '<h2>{{text:heading}}</h2>{{#list:items}}<li>{{text:label}}</li>{{/list:items}}',
      schema: '{"heading":{"type":"text"},"items":{"type":"list"}}',
    });
    project.component('card');
    project.page('index', ['host']);
    project.data('index', 'host', '- heading: "H1"\n  items:\n    - label: one\n- heading: "H2"\n  items:\n    - label: two\n');

    const c = capture();
    expect(await run(['context'], c.io)).toBe(0);
    const ctx = jsonOut(c);
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
    const spec = jsonOut(c);
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
    const result = jsonOut(c);
    expect(result.code).toBe('SCHEMA_VALIDATION');
    expect(result.fix).toBeTruthy();
  });

  it('lists every code when given none', async () => {
    const c = capture();
    expect(await run(['--json', 'explain'], c.io)).toBe(0);
    expect(jsonOut(c).codes.length).toBeGreaterThan(20);
  });

  it('returns 1 for an unknown code', async () => {
    const c = capture();
    expect(await run(['explain', 'NOT_A_CODE'], c.io)).toBe(1);
    expect(errText(c)).toContain('Unknown error code');
  });
});

describe('create data scaffolds valid shapes', () => {
  it('emits correct slot and list stubs derived from the template', async () => {
    project.component('host', {
      template: '<h2>{{text:heading}}</h2>{{#list:items}}<li>{{text:icon}} {{text:label}}</li>{{/list:items}}{{slot:child}}{{image:pic}}',
      schema: '{"heading":{"type":"text"},"items":{"type":"list"},"child":{"type":"slot"},"pic":{"type":"image"}}',
    });
    project.page('index', ['host']);

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
    project.component('card', { template: '<div class="card">{{text:title}}</div>', schema: '{"title":{"type":"text"}}' });
    project.component('host', { template: '{{slot:child}}', schema: '{"child":{"type":"slot"}}' });
    project.page('index', ['host']);
    project.data('index', 'host', 'child:\n  component: card\n  data:\n    title: "Nested"\n');

    const c = capture();
    expect(await run(['render', 'component', 'host', '--page', 'index'], c.io)).toBe(0);
    expect(outText(c)).toContain('<div class="card">Nested</div>');
  });
});

describe('requireAltText', () => {
  function imageProject() {
    project.component('img', { template: '{{image:pic}}', schema: '{"pic":{"type":"image"}}' });
    project.page('index', ['img']);
  }

  it('fails when alt is absent and the config requires it', async () => {
    project.configure({ requireAltText: true });
    imageProject();
    project.data('index', 'img', 'pic:\n  src: "a.webp"\n');

    const c = capture();
    expect(await run(['render', 'page', 'index', '--compact'], c.io)).toBe(1);
    expect(errText(c)).toContain("Image \"pic\" is missing alt text");
  });

  it('accepts an empty alt string (decorative image)', async () => {
    project.configure({ requireAltText: true });
    imageProject();
    project.data('index', 'img', 'pic:\n  src: "a.webp"\n  alt: ""\n');

    const c = capture();
    expect(await run(['render', 'page', 'index', '--compact'], c.io)).toBe(0);
  });

  it('skips the check when disabled', async () => {
    project.configure({ requireAltText: false });
    imageProject();
    project.data('index', 'img', 'pic:\n  src: "a.webp"\n');

    const c = capture();
    expect(await run(['render', 'page', 'index', '--compact'], c.io)).toBe(0);
  });
});

describe('cache tracks design tokens and config', () => {
  it('marks a page stale after design-tokens.yaml changes', async () => {
    project.component('sec');
    project.page('index', ['sec']);
    project.data('index', 'sec', 'heading: "A"\n');

    expect(await run(['build'], capture().io)).toBe(0);
    expect(isStale(dir, 'index')).toBe(false);

    writeFileSync(join(dir, 'design-tokens.yaml'), 'primary: "#ff0000"\n');
    expect(isStale(dir, 'index')).toBe(true);
  });
});
