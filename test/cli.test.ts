import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { run } from '../src/cli.js';
import { parseArgs } from '../src/cli-args.js';
import { capture, outText, errText, createProject, type FixtureProject } from './helpers/fixture.js';

let dir: string;
let project: FixtureProject;
let originalCwd: string;

beforeEach(() => {
  originalCwd = process.cwd();
  project = createProject({ prefix: 'htmlng-cli-' });
  dir = project.dir;
  process.chdir(dir);
});

afterEach(() => {
  process.chdir(originalCwd);
  project.remove();
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
    project.component('sec');
    project.page('index', ['sec']);
    project.data('index', 'sec', 'heading: "Hi"\n');

    const c = capture();
    expect(await run(['validate'], c.io)).toBe(0);
    expect(outText(c)).toContain('Validation passed.');
  });

  it('returns 1, reports the error, and does NOT claim success on bad data', async () => {
    project.component('sec');
    project.page('index', ['sec']);
    project.data('index', 'sec', 'heading: 123\n');

    const c = capture();
    expect(await run(['validate'], c.io)).toBe(1);
    expect(outText(c)).not.toContain('Validation passed');
    expect(errText(c)).toContain('must be string');
    expect(errText(c)).toContain('Validation failed');
  });

  it('reports required sub-field failures with the field name', async () => {
    project.component('sec', { template: '<p>{{link:cta}}</p>', schema: '{"cta":{"type":"link"}}' });
    project.page('index', ['sec']);
    project.data('index', 'sec', 'cta:\n  label: "Go"\n');

    const c = capture();
    expect(await run(['validate'], c.io)).toBe(1);
    expect(errText(c)).toContain("must have required property 'href'");
  });
});

describe('run — build', () => {
  it('wipes build/ so deleted pages do not linger', async () => {
    project.component('sec');
    project.page('index', ['sec']);
    project.page('b', ['sec']);
    project.data('index', 'sec', 'heading: "A"\n');
    project.data('b', 'sec', 'heading: "B"\n');

    expect(await run(['build'], capture().io)).toBe(0);
    expect(existsSync(join(dir, 'build', 'index.html'))).toBe(true);
    expect(existsSync(join(dir, 'build', 'b.html'))).toBe(true);

    rmSync(join(dir, 'pages', 'b.page.yaml'));
    expect(await run(['build'], capture().io)).toBe(0);
    expect(existsSync(join(dir, 'build', 'index.html'))).toBe(true);
    expect(existsSync(join(dir, 'build', 'b.html'))).toBe(false);
  });

  it('builds only the named page for a targeted build', async () => {
    project.component('sec');
    project.page('index', ['sec']);
    project.page('b', ['sec']);
    project.data('index', 'sec', 'heading: "A"\n');
    project.data('b', 'sec', 'heading: "B"\n');

    expect(await run(['build', 'b'], capture().io)).toBe(0);
    expect(existsSync(join(dir, 'build', 'b.html'))).toBe(true);
    expect(existsSync(join(dir, 'build', 'index.html'))).toBe(false);
  });

  it('accepts the explicit "page" keyword form', async () => {
    project.component('sec');
    project.page('index', ['sec']);
    project.data('index', 'sec', 'heading: "A"\n');

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
    project.page('index', ['ghost']);
    const c = capture();
    expect(await run(['render', 'page', 'index'], c.io)).toBe(1);
    expect(errText(c)).toContain('Component file not found');
  });

  it('does not emit a duplicate footer id when a footer component is not last', async () => {
    project.component('hero', { template: '<h1>{{text:heading}}</h1>' });
    project.component('footer', { template: '<p>{{text:heading}}</p>' });
    project.page('index', ['footer', 'hero']);
    project.data('index', 'hero', 'heading: "H"\n');
    project.data('index', 'footer', 'heading: "F"\n');

    const c = capture();
    expect(await run(['render', 'page', 'index', '--compact'], c.io)).toBe(0);
    expect(outText(c).match(/id="footer"/g)?.length ?? 0).toBe(1);
  });
});
