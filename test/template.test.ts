import { describe, it, expect } from 'vitest';
import { renderTemplate } from '../src/template.js';
import type { Component } from '../src/types.js';
import { EngineError } from '../src/types.js';

// Minimal component map for slot tests
const cardComp: Component = {
  name: 'card',
  template: '<div class="card"><h3>{{text:title}}</h3><p>{{text:body}}</p></div>',
  css: '',
  schema: { title: { type: 'text' }, body: { type: 'text' } },
};

const emptyMap = new Map<string, Component>();

describe('renderTemplate — inline placeholders', () => {
  it('renders {{text:name}}', () => {
    const result = renderTemplate('<h1>{{text:heading}}</h1>', { heading: 'Hello' }, emptyMap);
    expect(result).toBe('<h1>Hello</h1>');
  });

  it('renders empty string for missing text', () => {
    const result = renderTemplate('<p>{{text:missing}}</p>', {}, emptyMap);
    expect(result).toBe('<p></p>');
  });

  it('renders {{html:name}} raw', () => {
    const result = renderTemplate('<div>{{html:cta}}</div>', { cta: '<a href="/">Go</a>' }, emptyMap);
    expect(result).toBe('<div><a href="/">Go</a></div>');
  });

  it('renders {{image:name}}', () => {
    const result = renderTemplate('{{image:hero}}', {
      hero: { src: 'img.webp', alt: 'Hero', width: 800, loading: 'lazy' },
    }, emptyMap);
    expect(result).toContain('src="img.webp"');
    expect(result).toContain('alt="Hero"');
    expect(result).toContain('width="800"');
    expect(result).toContain('loading="lazy"');
  });

  it('renders {{link:name}}', () => {
    const result = renderTemplate('{{link:cta}}', {
      cta: { href: '/signup', label: 'Sign Up' },
    }, emptyMap);
    expect(result).toBe('<a href="/signup">Sign Up</a>');
  });

  it('renders empty for missing image/link', () => {
    expect(renderTemplate('{{image:missing}}', {}, emptyMap)).toBe('');
    expect(renderTemplate('{{link:missing}}', {}, emptyMap)).toBe('');
  });
});

describe('renderTemplate — blocks', () => {
  it('renders {{#list:name}} with array of objects', () => {
    const template = '{{#list:items}}<li>{{text:title}}</li>{{/list:items}}';
    const data = { items: [{ title: 'A' }, { title: 'B' }] };
    expect(renderTemplate(template, data, emptyMap)).toBe('<li>A</li><li>B</li>');
  });

  it('renders {{#list:name}} with array of scalars using {{text:this}}', () => {
    const template = '{{#list:items}}<li>{{text:this}}</li>{{/list:items}}';
    const data = { items: ['a', 'b'] };
    expect(renderTemplate(template, data, emptyMap)).toBe('<li>a</li><li>b</li>');
  });

  it('renders empty for empty list', () => {
    const result = renderTemplate('{{#list:items}}<li>x</li>{{/list:items}}', { items: [] }, emptyMap);
    expect(result).toBe('');
  });

  it('renders {{#bool:name}} when true', () => {
    const result = renderTemplate('{{#bool:show}}<span>Yes</span>{{/bool:show}}', { show: true }, emptyMap);
    expect(result).toBe('<span>Yes</span>');
  });

  it('renders empty when bool is false', () => {
    const result = renderTemplate('{{#bool:show}}<span>Yes</span>{{/bool:show}}', { show: false }, emptyMap);
    expect(result).toBe('');
  });

  it('handles nested blocks', () => {
    const template = '{{#list:items}}{{#bool:show}}<li>{{text:name}}</li>{{/bool:show}}{{/list:items}}';
    const data = { items: [{ name: 'A', show: true }, { name: 'B', show: false }] };
    expect(renderTemplate(template, data, emptyMap)).toBe('<li>A</li>');
  });

  it('throws on unclosed block', () => {
    expect(() => renderTemplate('{{#list:items}}unclosed', { items: [] }, emptyMap))
      .toThrow(EngineError);
  });
});

describe('renderTemplate — slot', () => {
  const comps = new Map([['card', cardComp]]);

  it('renders a nested component via {{slot:name}}', () => {
    const result = renderTemplate('{{slot:child}}', {
      child: { component: 'card', data: { title: 'Hi', body: 'World' } },
    }, comps);
    expect(result).toContain('<div class="card">');
    expect(result).toContain('<h3>Hi</h3>');
    expect(result).toContain('<p>World</p>');
  });

  it('throws on depth > 3', () => {
    // Create a self-referencing scenario via depth
    const inner: Component = {
      name: 'inner',
      template: '{{slot:next}}',
      css: '',
      schema: { next: { type: 'slot' } },
    };
    const compsInner = new Map([['inner', inner]]);
    const data: Record<string, unknown> = {
      next: { component: 'inner', data: { next: { component: 'inner', data: { next: { component: 'inner' } } } } },
    };
    expect(() => renderTemplate('{{slot:next}}', data as Record<string, unknown> as never, compsInner))
      .toThrow(EngineError);
  });
});
