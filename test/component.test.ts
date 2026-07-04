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
