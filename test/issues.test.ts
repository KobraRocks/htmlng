import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { run } from '../src/cli.js';
import { renderPage } from '../src/renderer.js';
import { parseComponent } from '../src/component.js';
import { validateComponent } from '../src/validator.js';
import { EngineError } from '../src/types.js';
import { FORMAT_SPEC } from '../src/format-spec.js';

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
const jsonOut = (c: Capture) => JSON.parse(outText(c));

let dir: string;
let originalCwd: string;

function component(
  name: string,
  opts: { template?: string; css?: string; schema?: string } = {},
): void {
  const template = opts.template ?? '<h2>{{text:heading}}</h2>';
  const css = opts.css ?? '';
  const schema = opts.schema ?? '{"heading":{"type":"text","required":true}}';
  writeFileSync(
    join(dir, 'components', `${name}.component.html`),
    `${template}\n---\n${css}\n---\n${schema}\n`,
  );
}

function page(name: string, components: string[], extra = ''): void {
  const list = components.map((c) => `  - ${c}`).join('\n');
  writeFileSync(
    join(dir, 'pages', `${name}.page.yaml`),
    `title: "${name}"\ndescription: "d"\ncomponents:\n${list}\n${extra}`,
  );
}

function data(pageName: string, comp: string, yaml: string): void {
  mkdirSync(join(dir, 'data', pageName), { recursive: true });
  writeFileSync(join(dir, 'data', pageName, `${comp}.yaml`), yaml);
}

function componentCode(name: string): string | undefined {
  try {
    validateComponent(parseComponent(join(dir, 'components', `${name}.component.html`)));
  } catch (e) {
    return e instanceof EngineError ? e.code : String(e);
  }
  return undefined;
}

beforeEach(() => {
  originalCwd = process.cwd();
  dir = mkdtempSync(join(tmpdir(), 'htmlng-issues-'));
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

describe('issue 08 — wrapper roles are name-based, not positional', () => {
  it('wraps header/footer by name and everything else in <section>', () => {
    component('header');
    component('hero');
    component('deck');
    component('footer');
    page('index', ['header', 'hero', 'deck', 'footer']);
    for (const c of ['header', 'hero', 'deck', 'footer']) data('index', c, 'heading: "H"\n');

    const html = renderPage(dir, 'index');
    expect(html).toContain('<header id="header" class="header">');
    expect(html).toContain('<section id="hero" class="hero">');
    // A shell component declared last must not become <footer>.
    expect(html).toContain('<section id="deck" class="deck">');
    expect(html).toContain('<footer id="footer" class="footer">');
  });
});

describe('issue 09 — page-level container', () => {
  it('wraps components in <div id="page"> when layout.wrapper is true', async () => {
    component('sec');
    page('index', ['sec'], 'layout:\n  wrapper: true\n');
    data('index', 'sec', 'heading: "H"\n');

    const html = renderPage(dir, 'index');
    expect(html).toContain('<div id="page" class="page">');
    expect(html.indexOf('<div id="page"')).toBeLessThan(html.indexOf('<section id="sec"'));

    const c = capture();
    expect(await run(['validate'], c.io)).toBe(0);
  });

  it('emits no wrapper by default', () => {
    component('sec');
    page('index', ['sec']);
    data('index', 'sec', 'heading: "H"\n');
    expect(renderPage(dir, 'index')).not.toContain('<div id="page"');
  });
});

describe('issue 10 — <body> page identity', () => {
  it('always emits the page name and optional layout.bodyClass', () => {
    component('sec');
    page('index', ['sec'], 'layout:\n  bodyClass: "deck slide-1"\n');
    data('index', 'sec', 'heading: "H"\n');
    expect(renderPage(dir, 'index')).toContain(
      '<body class="index deck slide-1" data-page="index">',
    );
  });
});

describe('issue 13 — page script placement', () => {
  it('emits scripts at the end of <body> by default and validates', async () => {
    component('sec');
    page('index', ['sec'], 'scripts:\n  - src: "assets/nav.js"\n');
    data('index', 'sec', 'heading: "H"\n');

    const c = capture();
    expect(await run(['validate'], c.io)).toBe(0);
    expect(renderPage(dir, 'index')).toMatch(/<script src="assets\/nav\.js"><\/script>\s*<\/body>/);
  });

  it('auto-defers <head> scripts so the DOM exists when they run', () => {
    component('sec');
    page('index', ['sec'], 'scripts:\n  - src: "assets/nav.js"\n    head: true\n');
    data('index', 'sec', 'heading: "H"\n');
    expect(renderPage(dir, 'index')).toContain('<script src="assets/nav.js" defer></script>');
  });
});

describe('issue 12 — element placeholders cannot be attribute values', () => {
  it('rejects {{image:...}} inside an attribute', () => {
    component('sec', {
      template: '<img class="logo" src="{{image:logo}}" alt="{{text:alt}}">',
      schema: '{"logo":{"type":"image"},"alt":{"type":"text"}}',
    });
    expect(componentCode('sec')).toBe('COMPONENT_PLACEHOLDER_IN_ATTRIBUTE');
  });

  it('accepts the placeholder as element content', () => {
    component('sec', {
      template: '<span class="logo">{{image:logo}}</span>',
      schema: '{"logo":{"type":"image"}}',
    });
    expect(componentCode('sec')).toBeUndefined();
  });
});

describe('issue 14 — field-level conditionals', () => {
  it('renders {{#if}}/{{#unless}} and does not warn about fields inside them', async () => {
    component('sec', {
      template:
        '{{#if:show}}<h1>{{text:heading}}</h1>{{/if:show}}' +
        '{{#unless:show}}<p>{{text:fallback}}</p>{{/unless:show}}',
      schema: '{"show":{"type":"bool"},"heading":{"type":"text"},"fallback":{"type":"text"}}',
    });
    page('index', ['sec']);
    data('index', 'sec', 'show: true\nheading: "Hi"\nfallback: "No"\n');

    const html = renderPage(dir, 'index');
    expect(html).toContain('<h1>Hi</h1>');
    expect(html).not.toContain('<p>No</p>');

    const c = capture();
    expect(await run(['validate', '--json'], c.io)).toBe(0);
    expect(jsonOut(c).warnings).toEqual([]);
  });

  it('does not flag a list item field as a template placeholder', () => {
    component('sec', {
      template: '<ul>{{#list:items}}<li>{{text:title}}</li>{{/list:items}}</ul>',
      schema: '{"items":{"type":"list"}}',
    });
    expect(componentCode('sec')).toBeUndefined();
  });

  it('treats a field read inside a list block as used (no false unused warning)', () => {
    component('sec', {
      template: '<ul>{{#list:items}}<li>{{text:title}}</li>{{/list:items}}</ul>',
      schema: '{"items":{"type":"list"},"title":{"type":"text"}}',
    });
    const warnings = validateComponent(parseComponent(join(dir, 'components', 'sec.component.html')));
    expect(warnings.map((w) => w.code)).not.toContain('SCHEMA_FIELD_UNUSED');
  });
});

describe('issue 15 — diagnostics', () => {
  it('names the failing array element', async () => {
    component('sec', {
      template: '<p>{{text:body}}</p>',
      schema: '{"body":{"type":"text","maxLength":5}}',
    });
    page('index', ['sec']);
    data('index', 'sec', '- body: "ok"\n- body: "ok"\n- body: "way too long"\n');

    const c = capture();
    expect(await run(['validate', '--json'], c.io)).toBe(1);
    expect(jsonOut(c).errors[0].message).toContain('element [2]');
  });

  it('warns about a data file whose component the page no longer lists', async () => {
    component('sec');
    page('index', ['sec']);
    data('index', 'sec', 'heading: "H"\n');
    data('index', 'stale', 'heading: "X"\n');

    const c = capture();
    expect(await run(['validate', '--json'], c.io)).toBe(0);
    expect(jsonOut(c).warnings.map((w: { code: string }) => w.code)).toContain('DATA_FILE_ORPHAN');
  });

  it('reports a warning once, not once per page and per component', async () => {
    component('sec', {
      template: '<p>{{text:used}}</p>',
      schema: '{"used":{"type":"text"},"spare":{"type":"text"}}',
    });
    page('index', ['sec']);
    data('index', 'sec', 'used: "x"\n');

    const c = capture();
    expect(await run(['validate', '--json'], c.io)).toBe(0);
    const unused = jsonOut(c).warnings.filter(
      (w: { code: string }) => w.code === 'SCHEMA_FIELD_UNUSED',
    );
    expect(unused.length).toBe(1);
  });

  it('reports a shared-component warning once in build too', async () => {
    component('sec', {
      template: '<p>{{text:used}}</p>',
      schema: '{"used":{"type":"text"},"spare":{"type":"text"}}',
    });
    page('a', ['sec']);
    page('b', ['sec']);
    data('a', 'sec', 'used: "x"\n');
    data('b', 'sec', 'used: "y"\n');

    const c = capture();
    expect(await run(['build', '--json'], c.io)).toBe(0);
    const unused = jsonOut(c).warnings.filter(
      (w: { code: string }) => w.code === 'SCHEMA_FIELD_UNUSED',
    );
    expect(unused.length).toBe(1);
  });

  it('attributes page structural errors to the page so two pages stay distinct', async () => {
    component('sec');
    page('a', ['sec', 'sec']);
    page('b', ['sec', 'sec']);
    data('a', 'sec', 'heading: "x"\n');
    data('b', 'sec', 'heading: "y"\n');

    const c = capture();
    expect(await run(['validate', '--json'], c.io)).toBe(1);
    const files = jsonOut(c).errors
      .filter((e: { code: string }) => e.code === 'PAGE_DUPLICATE_ID')
      .map((e: { file: string }) => e.file)
      .sort();
    expect(files).toEqual(['pages/a.page.yaml', 'pages/b.page.yaml']);
  });

  it('never reports a read-only component render as cached', async () => {
    component('sec');
    page('index', ['sec']);
    data('index', 'sec', 'heading: "H"\n');
    await run(['build'], capture().io);

    const c = capture();
    expect(await run(['render', 'component', 'sec', '--page', 'index'], c.io)).toBe(0);
    expect(outText(c)).toContain('=== STATUS: rendered');
    expect(outText(c)).not.toContain('cached');
  });
});

describe('issue 11 — repetition vs nested list is documented and explained', () => {
  it('separates the two data shapes in the machine spec', () => {
    expect(FORMAT_SPEC.dataShapes.componentRepetition).toContain('YAML sequence');
    expect(FORMAT_SPEC.dataShapes.nestedList).toContain('inside one instance');
  });

  it('explains that a nested item schema is unsupported', () => {
    component('sec', {
      template: '<ul>{{#list:items}}<li>{{text:title}}</li>{{/list:items}}</ul>',
      schema: '{"items":{"type":"list"},"item":{"title":{"type":"text"}}}',
    });
    let message = '';
    try {
      parseComponent(join(dir, 'components', 'sec.component.html'));
    } catch (e) {
      message = e instanceof EngineError ? e.message : String(e);
    }
    expect(message).toContain('nested item schemas are not supported');
  });

  it('does not advertise if/unless as schema types', () => {
    expect(FORMAT_SPEC.schemaTypes).not.toContain('if');
    expect(FORMAT_SPEC.schemaTypes).not.toContain('unless');
    const guards = FORMAT_SPEC.placeholderTypes
      .filter((p) => (p as { guardOnly?: boolean }).guardOnly === true)
      .map((p) => p.type);
    expect(guards).toEqual(['if', 'unless']);
  });

  it('rejects a schema entry typed as a guard', () => {
    component('sec', { template: '<p>x</p>', schema: '{"show":{"type":"if"}}' });
    expect(componentCode('sec')).toBe('COMPONENT_PLACEHOLDER_TYPE');
  });
});

describe('issue 17 — natural page ordering', () => {
  it('lists slide-2 before slide-10', async () => {
    component('sec');
    for (const n of [1, 2, 10]) {
      page(`slide-${n}`, ['sec']);
      data(`slide-${n}`, 'sec', 'heading: "H"\n');
    }
    const c = capture();
    expect(await run(['list', 'pages'], c.io)).toBe(0);
    expect(outText(c).trim().split('\n')).toEqual(['slide-1', 'slide-2', 'slide-10']);
  });
});
