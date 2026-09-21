import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { run, parseArgs } from '../src/cli.js';

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

let dir: string;
let originalCwd: string;

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
  dir = mkdtempSync(join(tmpdir(), 'htmlng-cli-'));
  mkdirSync(join(dir, 'components'));
  mkdirSync(join(dir, 'pages'));
  writeFileSync(
    join(dir, 'engine.config.yaml'),
    'project:\n  name: "T"\n  lang: "en"\npaths:\n  components: "components"\n  pages: "pages"\n  data: "data"\n  assets: "assets"\n  build: "build"\nbuild:\n  inlineCSS: false\n',
  );
  writeFileSync(join(dir, 'global.css'), 'body { margin: 0; }\n');
  process.chdir(dir);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(dir, { recursive: true, force: true });
});

describe('parseArgs', () => {
  it('splits command, positionals, and flags', () => {
    const parsed = parseArgs(['render', 'component', 'hero', '--page', 'index', '--all']);
    expect(parsed.command).toBe('render');
    expect(parsed.args).toEqual(['component', 'hero']);
    expect(parsed.flags.get('--page')).toBe('index');
    expect(parsed.flags.get('--all')).toBe(true);
  });

  it('normalizes -h to --help', () => {
    expect(parseArgs(['-h']).flags.get('--help')).toBe(true);
  });

  it('rejects unknown flags instead of silently dropping them', () => {
    expect(() => parseArgs(['build', '--bogus'])).toThrow(/Unknown flag/);
  });

  it('rejects a value flag with no value', () => {
    expect(() => parseArgs(['render', 'component', 'x', '--page'])).toThrow(/requires a value/);
  });
});

describe('run — dispatch and exit codes', () => {
  it('prints help and returns 0 for --help', async () => {
    const c = capture();
    expect(await run(['--help'], c.io)).toBe(0);
    expect(outText(c)).toContain('Usage: htmlng');
  });

  it('prints help and returns 0 with no arguments', async () => {
    const c = capture();
    expect(await run([], c.io)).toBe(0);
    expect(outText(c)).toContain('Usage: htmlng');
  });

  it('returns 1 and reports an unknown command', async () => {
    const c = capture();
    expect(await run(['frobnicate'], c.io)).toBe(1);
    expect(errText(c)).toContain('Unknown command: frobnicate');
  });

  it('returns 1 and reports an unknown flag', async () => {
    const c = capture();
    expect(await run(['build', '--nope'], c.io)).toBe(1);
    expect(errText(c)).toContain('Unknown flag: --nope');
  });

  it('returns 1 when a value flag is missing its value', async () => {
    const c = capture();
    expect(await run(['render', 'component', 'x', '--page'], c.io)).toBe(1);
    expect(errText(c)).toContain('requires a value');
  });
});

describe('run — validate is a real gate', () => {
  it('returns 0 and reports success on a clean project', async () => {
    component('sec');
    page('index', ['sec']);
    data('index', 'sec', 'heading: "Hi"\n');

    const c = capture();
    expect(await run(['validate'], c.io)).toBe(0);
    expect(outText(c)).toContain('Validation passed.');
  });

  it('returns 1, reports the error, and does NOT claim success on bad data', async () => {
    component('sec');
    page('index', ['sec']);
    data('index', 'sec', 'heading: 123\n');

    const c = capture();
    expect(await run(['validate'], c.io)).toBe(1);
    expect(outText(c)).not.toContain('Validation passed');
    expect(errText(c)).toContain('must be string');
    expect(errText(c)).toContain('Validation failed');
  });

  it('reports required sub-field failures with the field name', async () => {
    component('sec', { template: '<p>{{link:cta}}</p>', schema: '{"cta":{"type":"link"}}' });
    page('index', ['sec']);
    data('index', 'sec', 'cta:\n  label: "Go"\n');

    const c = capture();
    expect(await run(['validate'], c.io)).toBe(1);
    expect(errText(c)).toContain("must have required property 'href'");
  });
});

describe('run — build', () => {
  it('wipes build/ so deleted pages do not linger', async () => {
    component('sec');
    page('index', ['sec']);
    page('b', ['sec']);
    data('index', 'sec', 'heading: "A"\n');
    data('b', 'sec', 'heading: "B"\n');

    expect(await run(['build'], capture().io)).toBe(0);
    expect(existsSync(join(dir, 'build', 'index.html'))).toBe(true);
    expect(existsSync(join(dir, 'build', 'b.html'))).toBe(true);

    rmSync(join(dir, 'pages', 'b.page.yaml'));
    expect(await run(['build'], capture().io)).toBe(0);
    expect(existsSync(join(dir, 'build', 'index.html'))).toBe(true);
    expect(existsSync(join(dir, 'build', 'b.html'))).toBe(false);
  });

  it('builds only the named page for a targeted build', async () => {
    component('sec');
    page('index', ['sec']);
    page('b', ['sec']);
    data('index', 'sec', 'heading: "A"\n');
    data('b', 'sec', 'heading: "B"\n');

    expect(await run(['build', 'b'], capture().io)).toBe(0);
    expect(existsSync(join(dir, 'build', 'b.html'))).toBe(true);
    expect(existsSync(join(dir, 'build', 'index.html'))).toBe(false);
  });

  it('accepts the explicit "page" keyword form', async () => {
    component('sec');
    page('index', ['sec']);
    data('index', 'sec', 'heading: "A"\n');

    expect(await run(['build', 'page', 'index'], capture().io)).toBe(0);
    expect(existsSync(join(dir, 'build', 'index.html'))).toBe(true);
  });
});

describe('run — scaffolding guards', () => {
  it('refuses to create a component without a name', async () => {
    const c = capture();
    expect(await run(['create', 'component'], c.io)).toBe(1);
    expect(errText(c)).toContain('Missing component name');
    expect(existsSync(join(dir, 'components', 'undefined.component.html'))).toBe(false);
  });

  it('refuses a name containing path separators', async () => {
    const c = capture();
    expect(await run(['create', 'component', '../evil'], c.io)).toBe(1);
    expect(errText(c)).toContain('Invalid component name');
  });
});

describe('run — render failures are reported with a code', () => {
  it('returns 1 when a page references a missing component', async () => {
    page('index', ['ghost']);
    const c = capture();
    expect(await run(['render', 'page', 'index'], c.io)).toBe(1);
    expect(errText(c)).toContain('Component file not found');
  });

  it('does not emit a duplicate footer id when a footer component is not last', async () => {
    component('hero', { template: '<h1>{{text:heading}}</h1>' });
    component('footer', { template: '<p>{{text:heading}}</p>' });
    page('index', ['footer', 'hero']);
    data('index', 'hero', 'heading: "H"\n');
    data('index', 'footer', 'heading: "F"\n');

    const c = capture();
    expect(await run(['render', 'page', 'index', '--compact'], c.io)).toBe(0);
    expect(outText(c).match(/id="footer"/g)?.length ?? 0).toBe(1);
  });
});
