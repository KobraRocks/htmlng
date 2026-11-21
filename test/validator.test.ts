import { describe, it, expect } from 'vitest';
import { validateComponent, validatePageStructure } from '../src/validator.js';
import type { Component } from '../src/types.js';
import { EngineError } from '../src/types.js';

describe('validateComponent', () => {
  const validComp: Component = {
    name: 'test',
    template: '<h1>{{text:heading}}</h1><p>{{text:body}}</p>',
    css: '',
    schema: { heading: { type: 'text', required: true }, body: { type: 'text', required: false } },
  };

  it('passes a valid component', () => {
    expect(() => validateComponent(validComp)).not.toThrow();
  });

  it('rejects <script> in template', () => {
    const comp = { ...validComp, template: '<script>alert(1)</script>' };
    expect(() => validateComponent(comp)).toThrow(EngineError);
  });

  it('rejects <style> in template', () => {
    const comp = { ...validComp, template: '<style>body{}</style>' };
    expect(() => validateComponent(comp)).toThrow(EngineError);
  });

  it('rejects inline style attribute', () => {
    const comp = { ...validComp, template: '<div style="color:red">x</div>' };
    expect(() => validateComponent(comp)).toThrow(EngineError);
  });

  it('rejects template placeholder not in schema', () => {
    const comp = { ...validComp, template: '<h1>{{text:title}}</h1>', schema: { heading: { type: 'text' } } };
    expect(() => validateComponent(comp)).toThrow(EngineError);
    try { validateComponent(comp); } catch (e) {
      expect((e as EngineError).message).toContain('title');
      expect((e as EngineError).message).toContain('schema has no matching entry');
    }
  });

  it('warns when schema field not used in template', () => {
    const comp = { ...validComp, template: '<h1>{{text:heading}}</h1>', schema: { heading: { type: 'text' }, body: { type: 'text' } } };
    const warnings = validateComponent(comp);
    expect(warnings.length).toBe(1);
    expect(warnings[0].level).toBe('WARNING');
    expect(warnings[0].message).toContain('body');
  });

  it('handles list and bool block placeholders — inner fields not required in schema', () => {
    const comp: Component = {
      name: 'list-test',
      template: '{{#list:items}}<li>{{text:title}}</li>{{/list:items}}{{#bool:show}}yes{{/bool:show}}',
      css: '',
      schema: { items: { type: 'list' }, show: { type: 'bool' } },
    };
    // 'title' inside list block should NOT need to be in schema
    expect(() => validateComponent(comp)).not.toThrow();
  });
});

describe('validatePageStructure', () => {
  it('accepts valid body structure', () => {
    const html = '<!DOCTYPE html><html><head></head><body><header id="h" class="h">x</header><section id="s" class="s">y</section><footer id="f" class="f">z</footer></body></html>';
    expect(() => validatePageStructure(html)).not.toThrow();
  });

  it('rejects non-semantic body children', () => {
    const html = '<!DOCTYPE html><html><head></head><body><div>bad</div></body></html>';
    expect(() => validatePageStructure(html)).toThrow(EngineError);
  });

  it('rejects duplicate IDs', () => {
    const html = '<!DOCTYPE html><html><head></head><body><header id="dup" class="h">a</header><section id="dup" class="s">b</section></body></html>';
    expect(() => validatePageStructure(html)).toThrow(EngineError);
  });

  it('allows the page layout wrapper and body-end page scripts', () => {
    const html = '<!DOCTYPE html><html><head></head><body><div id="page" class="page"><section id="s" class="s">y</section></div><script src="a.js"></script></body></html>';
    expect(() => validatePageStructure(html)).not.toThrow();
  });

  it('does not treat data-id="page" as the layout wrapper', () => {
    const html = '<!DOCTYPE html><html><head></head><body><div data-id="page">bad</div></body></html>';
    expect(() => validatePageStructure(html)).toThrow(/Disallowed direct child/);
  });
});

describe('validateComponent — element placeholders in attributes', () => {
  const base: Component = { name: 'test', template: '', css: '', schema: { logo: { type: 'image' } } };

  it('rejects a quoted attribute value', () => {
    const comp = { ...base, template: '<img src="{{image:logo}}" alt="x">' };
    try {
      validateComponent(comp);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as EngineError).code).toBe('COMPONENT_PLACEHOLDER_IN_ATTRIBUTE');
    }
  });

  it('rejects an unquoted attribute value', () => {
    const comp = { ...base, template: '<img src={{image:logo}} alt="x">' };
    expect(() => validateComponent(comp)).toThrow(/emits a whole element/);
  });

  it('accepts the placeholder as element content', () => {
    const comp = { ...base, template: '<span class="logo">{{image:logo}}</span>' };
    expect(() => validateComponent(comp)).not.toThrow();
  });
});
