import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { run, JSON_SCHEMA_VERSION } from '../src/cli.js';
import { loadData } from '../src/data-file.js';
import { renderPage } from '../src/renderer.js';
import { capture, outText, errText, jsonOut, createProject, type FixtureProject } from './helpers/fixture.js';

let dir: string;
let project: FixtureProject;
let originalCwd: string;

beforeEach(() => {
  originalCwd = process.cwd();
  project = createProject({ prefix: 'htmlng-pc-' });
  dir = project.dir;
  process.chdir(dir);
});

afterEach(() => {
  process.chdir(originalCwd);
  project.remove();
});

describe('--json contract', () => {
  it('stamps schemaVersion on success payloads', async () => {
    project.component('sec');
    project.page('index', ['sec']);
    project.data('index', 'sec', 'heading: "Hi"\n');

    const c = capture();
    expect(await run(['--json', 'validate'], c.io)).toBe(0);
    expect(jsonOut(c).schemaVersion).toBe(JSON_SCHEMA_VERSION);
  });

  it('stamps schemaVersion on error payloads', async () => {
    const c = capture();
    expect(await run(['--json', 'bogus'], c.io)).toBe(1);
    expect(jsonOut(c).schemaVersion).toBe(JSON_SCHEMA_VERSION);
  });
});

describe('array data ids', () => {
  it('indexes a single-element array as <name>-0', async () => {
    project.component('sec');
    project.page('index', ['sec']);
    project.data('index', 'sec', '- heading: "only"\n');

    const c = capture();
    expect(await run(['render', 'page', 'index', '--compact'], c.io)).toBe(0);
    expect(outText(c)).toContain('id="sec-0"');
  });

  it('indexes a multi-element array in order', async () => {
    project.component('sec');
    project.page('index', ['sec']);
    project.data('index', 'sec', '- heading: "a"\n- heading: "b"\n');

    const html = renderPage(dir, 'index');
    expect(html).toContain('id="sec-0"');
    expect(html).toContain('id="sec-1"');
  });
});

describe('custom paths.data', () => {
  it('loads data from the configured directory', () => {
    project.configure({ paths: { data: 'content' } });
    project.component('sec');
    project.page('index', ['sec']);
    project.data('index', 'sec', 'heading: "from content"\n');

    const loaded = loadData(dir, 'index', 'sec');
    expect(loaded).toEqual({ heading: 'from content' });
    expect(renderPage(dir, 'index')).toContain('<h2>from content</h2>');
  });

  it('honors custom component and page directories too', () => {
    project.configure({ paths: { components: 'widgets', pages: 'routes' } });
    project.component('sec', { schema: '{"heading":{"type":"text"}}' });
    project.page('index', ['sec']);
    project.data('index', 'sec', 'heading: "custom dirs"\n');

    expect(renderPage(dir, 'index')).toContain('<h2>custom dirs</h2>');
  });
});

describe('redundant wrapper warning', () => {
  it('warns when a template duplicates the engine wrapper', async () => {
    project.component('box', {
      template: '<div class="box"><h2>{{text:heading}}</h2></div>',
      schema: '{"heading":{"type":"text"}}',
    });
    project.page('index', ['box']);
    project.data('index', 'box', 'heading: "Hi"\n');

    const c = capture();
    expect(await run(['--json', 'validate', 'component', 'box'], c.io)).toBe(0);
    const codes = jsonOut(c).warnings.map((w: { code: string }) => w.code);
    expect(codes).toContain('COMPONENT_REDUNDANT_WRAPPER');
    expect(errText(c)).toBe('');
  });

  it('explains the new code', async () => {
    const c = capture();
    expect(await run(['explain', 'COMPONENT_REDUNDANT_WRAPPER'], c.io)).toBe(0);
    expect(outText(c)).toContain('Remove the outer div');
  });
});
