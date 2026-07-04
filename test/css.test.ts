import { describe, it, expect } from 'vitest';
import { scopeCSS, assemblePageCSS } from '../src/css.js';
import type { Component } from '../src/types.js';

describe('scopeCSS', () => {
  it('prefixes a single selector', () => {
    expect(scopeCSS('h1 { color: red; }', 'hero')).toBe('.hero h1 { color: red; }');
  });

  it('prefixes multiple selectors in one rule', () => {
    expect(scopeCSS('h1, h2 { margin: 0; }', 'hero')).toBe('.hero h1, .hero h2 { margin: 0; }');
  });

  it('skips already-prefixed selectors', () => {
    expect(scopeCSS('.hero h1 { color: red; }', 'hero')).toBe('.hero h1 { color: red; }');
  });

  it('scopes selectors inside @media blocks', () => {
    const input = '@media (max-width: 768px) {\nh1 { font-size: 2rem; }\n}';
    const result = scopeCSS(input, 'hero');
    expect(result).toContain('.hero h1');
    expect(result).toContain('@media (max-width: 768px)');
  });

  it('passes @keyframes through unchanged', () => {
    const input = '@keyframes fade {\nfrom { opacity: 0; }\nto { opacity: 1; }\n}';
    expect(scopeCSS(input, 'hero')).toBe(input);
  });

  it('passes @font-face through unchanged', () => {
    const input = '@font-face {\nfont-family: "Inter";\nsrc: url("inter.woff2");\n}';
    expect(scopeCSS(input, 'hero')).toBe(input);
  });

  it('returns empty for empty CSS', () => {
    expect(scopeCSS('', 'hero')).toBe('');
    expect(scopeCSS('  ', 'hero')).toBe('');
  });

  it('preserves comments', () => {
    const input = '/* comment */\nh1 { color: red; }';
    const result = scopeCSS(input, 'hero');
    expect(result).toContain('.hero h1');
  });
});

describe('assemblePageCSS', () => {
  const hero: Component = {
    name: 'hero', template: '', css: 'h1 { font-size: 3rem; }', schema: {},
  };
  const footer: Component = {
    name: 'footer', template: '', css: 'p { color: gray; }', schema: {},
  };
  const global = 'body { margin: 0; }\nh1 { font-weight: 700; }';

  it('assembles global + component CSS in order', () => {
    const result = assemblePageCSS([hero, footer], global);
    expect(result).toContain('body { margin: 0; }');
    expect(result).toContain('.hero h1');
    expect(result).toContain('.footer p');
    // Global CSS comes first, then components
    const globalIdx = result.indexOf('body');
    const heroIdx = result.indexOf('.hero');
    expect(globalIdx).toBeLessThan(heroIdx);
  });

  it('deduplicates rules that are byte-for-byte identical after scoping', () => {
    // Two components with the same class name produce identical scoped rules
    const a: Component = { name: 'card', template: '', css: '.btn { padding: 8px; }', schema: {} };
    const b: Component = { name: 'card', template: '', css: '.btn { padding: 8px; }', schema: {} };
    const result = assemblePageCSS([a, b], '');
    // .card .btn { padding: 8px; } should appear once
    const matches = result.match(/padding:\s*8px/g);
    expect(matches?.length).toBe(1);
  });
});
