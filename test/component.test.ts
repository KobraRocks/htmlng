import { describe, it, expect } from 'vitest';
import { parseComponent, findComponents } from '../src/component.js';
import { EngineError } from '../src/types.js';
import { join } from 'node:path';
import { writeFileSync, unlinkSync } from 'node:fs';

const FIXTURES = join(import.meta.dirname, 'fixtures');

describe('parseComponent', () => {
  it('parses a valid 3-section component file', () => {
    const comp = parseComponent(join(FIXTURES, 'components/hero.component.html'));
    expect(comp.name).toBe('hero');
    expect(comp.template).toContain('<h1>{{text:heading}}</h1>');
    expect(comp.css).toContain('h1 { font-size: 3rem; }');
    expect(comp.schema.heading).toEqual({ type: 'text', required: true, maxLength: 120 });
    expect(comp.schema.cta.type).toBe('html');
  });

  it('parses a component with no CSS section (2 sections)', () => {
    const comp = parseComponent(join(FIXTURES, 'components/features.component.html'));
    expect(comp.name).toBe('features');
    expect(comp.css).toBe('');
    expect(comp.template).toContain('{{#list:items}}');
    expect(comp.schema.items.type).toBe('list');
  });

  it('throws on missing file', () => {
    expect(() => parseComponent(join(FIXTURES, 'components/nonexistent.component.html')))
      .toThrow(EngineError);
  });

  it('throws on invalid JSON schema', () => {
    const tmp = join(FIXTURES, 'components/bad.component.html');
    writeFileSync(tmp, '<p>template</p>\n---\n{invalid json}');
    try {
      expect(() => parseComponent(tmp)).toThrow(EngineError);
    } finally {
      unlinkSync(tmp);
    }
  });
});

describe('parseComponent — section separators', () => {
  function withFile(content: string, fn: (path: string) => void) {
    const tmp = join(FIXTURES, 'components', `tmp-${Math.random().toString(36).slice(2)}.component.html`);
    writeFileSync(tmp, content);
    try { fn(tmp); } finally { unlinkSync(tmp); }
  }

  it('accepts an empty CSS section (two consecutive separators)', () => {
    withFile('<h2>{{text:heading}}</h2>\n---\n---\n{"heading":{"type":"text"}}\n', (p) => {
      const comp = parseComponent(p);
      expect(comp.template).toBe('<h2>{{text:heading}}</h2>');
      expect(comp.css).toBe('');
      expect(comp.schema.heading.type).toBe('text');
    });
  });

  it('tolerates CRLF line endings', () => {
    withFile('<h2>{{text:heading}}</h2>\r\n---\r\nh2 { color: red; }\r\n---\r\n{"heading":{"type":"text"}}\r\n', (p) => {
      const comp = parseComponent(p);
      expect(comp.template).toBe('<h2>{{text:heading}}</h2>');
      expect(comp.css).toBe('h2 { color: red; }');
      expect(comp.schema.heading.type).toBe('text');
    });
  });

  it('tolerates whitespace around a separator line', () => {
    withFile('<p>{{text:a}}</p>\n  ---  \nh2 { color: red; }\n---\n{"a":{"type":"text"}}\n', (p) => {
      const comp = parseComponent(p);
      expect(comp.template).toBe('<p>{{text:a}}</p>');
      expect(comp.css).toBe('h2 { color: red; }');
    });
  });

  it('ignores a trailing separator / blank tail', () => {
    withFile('<p>{{text:a}}</p>\n---\n{"a":{"type":"text"}}\n---\n', (p) => {
      const comp = parseComponent(p);
      expect(comp.schema.a.type).toBe('text');
    });
  });

  it('tolerates a leading BOM', () => {
    withFile('\uFEFF<p>{{text:a}}</p>\n---\n{"a":{"type":"text"}}\n', (p) => {
      const comp = parseComponent(p);
      expect(comp.template).toBe('<p>{{text:a}}</p>');
    });
  });

  it('rejects a file with too many sections', () => {
    withFile('a\n---\nb\n---\nc\n---\nd\n', (p) => {
      expect(() => parseComponent(p)).toThrow(/too many|sections/i);
    });
  });

  it('rejects a file with no separator', () => {
    withFile('<p>just a template</p>\n', (p) => {
      expect(() => parseComponent(p)).toThrow(EngineError);
    });
  });
});

describe('findComponents', () => {
  it('returns component names from a directory', () => {
    const names = findComponents(join(FIXTURES, 'components'));
    expect(names).toContain('hero');
    expect(names).toContain('features');
    expect(names).toContain('footer');
  });

  it('returns empty array for nonexistent directory', () => {
    expect(findComponents(join(FIXTURES, 'nonexistent'))).toEqual([]);
  });
});
