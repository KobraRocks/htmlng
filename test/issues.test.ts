import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { run } from '../src/cli.js';
import { renderPage } from '../src/renderer.js';
import { parseComponent } from '../src/component.js';
import { validateComponent } from '../src/validator.js';
import { EngineError } from '../src/types.js';
import { FORMAT_SPEC } from '../src/format-spec.js';
import { capture, outText, jsonOut, createProject, type FixtureProject } from './helpers/fixture.js';

let dir: string;
let project: FixtureProject;
let originalCwd: string;

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
  project = createProject({ prefix: 'htmlng-issues-' });
  dir = project.dir;
  process.chdir(dir);
});

afterEach(() => {
  process.chdir(originalCwd);
  project.remove();
});

describe('issue 08 — wrapper roles are name-based, not positional', () => {
  it('wraps header/footer by name and everything else in <section>', () => {
    project.component('header');
    project.component('hero');
    project.component('deck');
    project.component('footer');
    project.page('index', ['header', 'hero', 'deck', 'footer']);
    for (const c of ['header', 'hero', 'deck', 'footer']) project.data('index', c, 'heading: "H"\n');

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
    project.component('sec');
    project.page('index', ['sec'], 'layout:\n  wrapper: true\n');
    project.data('index', 'sec', 'heading: "H"\n');

    const html = renderPage(dir, 'index');
    expect(html).toContain('<div id="page" class="page">');
    expect(html.indexOf('<div id="page"')).toBeLessThan(html.indexOf('<section id="sec"'));

    const c = capture();
    expect(await run(['validate'], c.io)).toBe(0);
  });

  it('emits no wrapper by default', () => {
    project.component('sec');
    project.page('index', ['sec']);
    project.data('index', 'sec', 'heading: "H"\n');
    expect(renderPage(dir, 'index')).not.toContain('<div id="page"');
  });
});

describe('issue 10 — <body> page identity', () => {
  it('always emits the page name and optional layout.bodyClass', () => {
    project.component('sec');
    project.page('index', ['sec'], 'layout:\n  bodyClass: "deck slide-1"\n');
    project.data('index', 'sec', 'heading: "H"\n');
    expect(renderPage(dir, 'index')).toContain(
      '<body class="index deck slide-1" data-page="index">',
    );
  });
});

describe('issue 13 — page script placement', () => {
  it('emits scripts at the end of <body> by default and validates', async () => {
    project.component('sec');
    project.page('index', ['sec'], 'scripts:\n  - src: "assets/nav.js"\n');
    project.data('index', 'sec', 'heading: "H"\n');

    const c = capture();
    expect(await run(['validate'], c.io)).toBe(0);
    expect(renderPage(dir, 'index')).toMatch(/<script src="assets\/nav\.js"><\/script>\s*<\/body>/);
  });

  it('auto-defers <head> scripts so the DOM exists when they run', () => {
    project.component('sec');
    project.page('index', ['sec'], 'scripts:\n  - src: "assets/nav.js"\n    head: true\n');
    project.data('index', 'sec', 'heading: "H"\n');
    expect(renderPage(dir, 'index')).toContain('<script src="assets/nav.js" defer></script>');
  });
});

describe('issue 12 — element placeholders cannot be attribute values', () => {
  it('rejects {{image:...}} inside an attribute', () => {
    project.component('sec', {
      template: '<img class="logo" src="{{image:logo}}" alt="{{text:alt}}">',
      schema: '{"logo":{"type":"image"},"alt":{"type":"text"}}',
    });
    expect(componentCode('sec')).toBe('COMPONENT_PLACEHOLDER_IN_ATTRIBUTE');
  });

  it('accepts the placeholder as element content', () => {
    project.component('sec', {
      template: '<span class="logo">{{image:logo}}</span>',
      schema: '{"logo":{"type":"image"}}',
    });
    expect(componentCode('sec')).toBeUndefined();
  });
});

describe('issue 14 — field-level conditionals', () => {
  it('renders {{#if}}/{{#unless}} and does not warn about fields inside them', async () => {
    project.component('sec', {
      template:
        '{{#if:show}}<h1>{{text:heading}}</h1>{{/if:show}}' +
        '{{#unless:show}}<p>{{text:fallback}}</p>{{/unless:show}}',
      schema: '{"show":{"type":"bool"},"heading":{"type":"text"},"fallback":{"type":"text"}}',
    });
    project.page('index', ['sec']);
    project.data('index', 'sec', 'show: true\nheading: "Hi"\nfallback: "No"\n');

    const html = renderPage(dir, 'index');
    expect(html).toContain('<h1>Hi</h1>');
    expect(html).not.toContain('<p>No</p>');

    const c = capture();
    expect(await run(['validate', '--json'], c.io)).toBe(0);
    expect(jsonOut(c).warnings).toEqual([]);
  });

  it('does not flag a list item field as a template placeholder', () => {
    project.component('sec', {
      template: '<ul>{{#list:items}}<li>{{text:title}}</li>{{/list:items}}</ul>',
      schema: '{"items":{"type":"list"}}',
    });
    expect(componentCode('sec')).toBeUndefined();
  });

  it('warns when a schema field is only read as a list item field', () => {
    project.component('sec', {
      template: '<ul>{{#list:items}}<li>{{text:title}}</li>{{/list:items}}</ul>',
      schema: '{"items":{"type":"list"},"title":{"type":"text"}}',
    });
    const warnings = validateComponent(parseComponent(join(dir, 'components', 'sec.component.html')));
    expect(warnings.map((w) => w.code)).toContain('SCHEMA_FIELD_UNUSED');
    expect(warnings.find((w) => w.code === 'SCHEMA_FIELD_UNUSED')?.field).toBe('title');
  });
});

describe('issue 15 — diagnostics', () => {
  it('names the failing array element', async () => {
    project.component('sec', {
      template: '<p>{{text:body}}</p>',
      schema: '{"body":{"type":"text","maxLength":5}}',
    });
    project.page('index', ['sec']);
    project.data('index', 'sec', '- body: "ok"\n- body: "ok"\n- body: "way too long"\n');

    const c = capture();
    expect(await run(['validate', '--json'], c.io)).toBe(1);
    expect(jsonOut(c).errors[0].message).toContain('element [2]');
  });

  it('warns about a data file whose component the page no longer lists', async () => {
    project.component('sec');
    project.page('index', ['sec']);
    project.data('index', 'sec', 'heading: "H"\n');
    project.data('index', 'stale', 'heading: "X"\n');

    const c = capture();
    expect(await run(['validate', '--json'], c.io)).toBe(0);
    const orphan = jsonOut(c).warnings.find(
      (w: { code: string }) => w.code === 'DATA_FILE_ORPHAN',
    );
    expect(orphan.file).toBe(join(dir, 'data', 'index', 'stale.yaml'));
    expect(orphan.help).toContain('"stale"');
  });

  it('reports a warning once, not once per page and per component', async () => {
    project.component('sec', {
      template: '<p>{{text:used}}</p>',
      schema: '{"used":{"type":"text"},"spare":{"type":"text"}}',
    });
    project.page('index', ['sec']);
    project.data('index', 'sec', 'used: "x"\n');

    const c = capture();
    expect(await run(['validate', '--json'], c.io)).toBe(0);
    const unused = jsonOut(c).warnings.filter(
      (w: { code: string }) => w.code === 'SCHEMA_FIELD_UNUSED',
    );
    expect(unused.length).toBe(1);
  });

  it('reports a shared-component warning once in build too', async () => {
    project.component('sec', {
      template: '<p>{{text:used}}</p>',
      schema: '{"used":{"type":"text"},"spare":{"type":"text"}}',
    });
    project.page('a', ['sec']);
    project.page('b', ['sec']);
    project.data('a', 'sec', 'used: "x"\n');
    project.data('b', 'sec', 'used: "y"\n');

    const c = capture();
    expect(await run(['build', '--json'], c.io)).toBe(0);
    const unused = jsonOut(c).warnings.filter(
      (w: { code: string }) => w.code === 'SCHEMA_FIELD_UNUSED',
    );
    expect(unused.length).toBe(1);
  });

  it('attributes page structural errors to the page so two pages stay distinct', async () => {
    project.component('sec');
    project.page('a', ['sec', 'sec']);
    project.page('b', ['sec', 'sec']);
    project.data('a', 'sec', 'heading: "x"\n');
    project.data('b', 'sec', 'heading: "y"\n');

    const c = capture();
    expect(await run(['validate', '--json'], c.io)).toBe(1);
    const files = jsonOut(c).errors
      .filter((e: { code: string }) => e.code === 'PAGE_DUPLICATE_ID')
      .map((e: { file: string }) => e.file)
      .sort();
    expect(files).toEqual(['pages/a.page.yaml', 'pages/b.page.yaml']);
  });

  it('never reports a read-only component render as cached', async () => {
    project.component('sec');
    project.page('index', ['sec']);
    project.data('index', 'sec', 'heading: "H"\n');
    await run(['build'], capture().io);

    const c = capture();
    expect(await run(['render', 'component', 'sec', '--page', 'index'], c.io)).toBe(0);
    expect(outText(c)).toContain('=== STATUS: rendered');
    expect(outText(c)).not.toContain('cached');
  });
});

describe('issue 15.1 — element attribution', () => {
  it('names the failing sequence element when a text field has a block tag', async () => {
    project.component('sec', {
      template: '<p>{{text:body}}</p>',
      schema: '{"body":{"type":"text"}}',
    });
    project.page('index', ['sec']);
    project.data('index', 'sec', '- body: "fine"\n- body: "fine"\n- body: "<div>bad</div>"\n');

    const c = capture();
    expect(await run(['validate', '--json'], c.io)).toBe(1);
    const error = jsonOut(c).errors.find((e: { code: string }) => e.code === 'TEXT_BLOCK_TAG');
    expect(error.message.startsWith('element [2] ')).toBe(true);
  });

  it('reports one unused-key warning per sequence element instead of collapsing them', async () => {
    project.component('sec', {
      template: '<p>{{text:body}}</p>',
      schema: '{"body":{"type":"text"}}',
    });
    project.page('index', ['sec']);
    project.data('index', 'sec', '- body: "a"\n  extra: 1\n- body: "b"\n  extra: 2\n');

    const c = capture();
    expect(await run(['validate', '--json'], c.io)).toBe(0);
    const unused = jsonOut(c).warnings
      .filter((w: { code: string }) => w.code === 'DATA_KEY_UNUSED')
      .map((w: { message: string }) => w.message);
    expect(unused).toEqual([
      'element [0] Unused data key "extra" — not in component schema',
      'element [1] Unused data key "extra" — not in component schema',
    ]);
  });

  it('leaves map-form messages and warning counts unchanged', async () => {
    project.component('sec', {
      template: '<p>{{text:body}}</p>',
      schema: '{"body":{"type":"text"}}',
    });
    project.page('index', ['sec']);
    project.data('index', 'sec', 'body: "x"\nextra: 1\n');

    const c = capture();
    expect(await run(['validate', '--json'], c.io)).toBe(0);
    const unused = jsonOut(c).warnings.filter(
      (w: { code: string }) => w.code === 'DATA_KEY_UNUSED',
    );
    expect(unused.map((w: { message: string }) => w.message)).toEqual([
      'Unused data key "extra" — not in component schema',
    ]);
  });
});

describe('issue 11 — repetition vs nested list is documented and explained', () => {
  it('separates the two data shapes in the machine spec', () => {
    expect(FORMAT_SPEC.dataShapes.componentRepetition).toContain('YAML sequence');
    expect(FORMAT_SPEC.dataShapes.nestedList).toContain('inside one instance');
  });

  it('explains that a nested item schema is unsupported', () => {
    project.component('sec', {
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
    project.component('sec', { template: '<p>x</p>', schema: '{"show":{"type":"if"}}' });
    expect(componentCode('sec')).toBe('COMPONENT_PLACEHOLDER_TYPE');
  });
});

describe('issue 17 — natural page ordering', () => {
  it('lists slide-2 before slide-10', async () => {
    project.component('sec');
    for (const n of [1, 2, 10]) {
      project.page(`slide-${n}`, ['sec']);
      project.data(`slide-${n}`, 'sec', 'heading: "H"\n');
    }
    const c = capture();
    expect(await run(['list', 'pages'], c.io)).toBe(0);
    expect(outText(c).trim().split('\n')).toEqual(['slide-1', 'slide-2', 'slide-10']);
  });
});

describe('issue 8 — one canonical placeholder type list', () => {
  it('parses a schema for every advertised schema type', () => {
    const advertised = FORMAT_SPEC.placeholderTypes
      .filter((p) => !(p as { guardOnly?: boolean }).guardOnly)
      .map((p) => p.type)
      .sort();
    expect(advertised).toEqual([...FORMAT_SPEC.schemaTypes].sort());

    for (const type of advertised) {
      project.component('sec', { schema: `{"value":{"type":"${type}"}}` });
      expect(() => parseComponent(join(dir, 'components', 'sec.component.html'))).not.toThrow();
    }
  });
});
