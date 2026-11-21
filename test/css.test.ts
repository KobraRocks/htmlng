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

  it('does not scope selectors that target the document root', () => {
    expect(scopeCSS('body { display: flex; }', 'hero')).toBe('body { display: flex; }');
    expect(scopeCSS(':root { --x: 1; }', 'hero')).toBe(':root { --x: 1; }');
    expect(scopeCSS('html { height: 100%; }', 'hero')).toBe('html { height: 100%; }');
    expect(scopeCSS(':host { display: block; }', 'hero')).toBe(':host { display: block; }');
  });

  it('does not scope root selectors with additional compounds or combinators', () => {
    expect(scopeCSS('body.slide-1 > section { margin: 0; }', 'hero')).toBe(
      'body.slide-1 > section { margin: 0; }',
    );
  });

  it('still scopes a selector that merely starts with a root-like word', () => {
    expect(scopeCSS('bodyguard { color: red; }', 'hero')).toBe('.hero bodyguard { color: red; }');
  });

  it('unwraps :global(...) and opts the whole selector out of scoping', () => {
    expect(scopeCSS(':global(.leaflet-container) { z-index: 1; }', 'hero')).toBe(
      '.leaflet-container { z-index: 1; }',
    );
    expect(scopeCSS('body :global(.x) { color: red; }', 'hero')).toBe(
      'body .x { color: red; }',
    );
    expect(scopeCSS(':global( .y ) { color: red; }', 'hero')).toBe('.y { color: red; }');
  });

  it('still prefixes a normal selector', () => {
    expect(scopeCSS('h1 { color: red; }', 'hero')).toBe('.hero h1 { color: red; }');
  });

  it('keeps commas inside parentheses when splitting a selector list', () => {
    expect(scopeCSS(':global(.a, .b) { color: red; }', 'hero')).toBe(
      '.a, .b { color: red; }',
    );
    expect(scopeCSS(':is(h1, h2) { margin: 0; }', 'hero')).toBe(
      '.hero :is(h1, h2) { margin: 0; }',
    );
  });

  it('keeps commas inside quoted attribute selectors', () => {
    expect(scopeCSS('[data-role="a,b"] { color: red; }', 'hero')).toBe(
      '.hero [data-role="a,b"] { color: red; }',
    );
  });

  it('unwraps :global(...) with nested parentheses', () => {
    expect(scopeCSS(':global(.prose :not(.x) a) { color: red; }', 'hero')).toBe(
      '.prose :not(.x) a { color: red; }',
    );
    expect(scopeCSS(':global(ul li:not(:last-child) a) { color: red; }', 'hero')).toBe(
      'ul li:not(:last-child) a { color: red; }',
    );
  });

  it('does not treat a sibling class as already scoped', () => {
    expect(scopeCSS('.hero2 { color: red; }', 'hero')).toBe('.hero .hero2 { color: red; }');
    expect(scopeCSS('.hero-title { color: red; }', 'hero')).toBe('.hero .hero-title { color: red; }');
  });

  it('scopes custom elements that merely start with a root word', () => {
    expect(scopeCSS('body-copy { color: red; }', 'hero')).toBe('.hero body-copy { color: red; }');
    expect(scopeCSS('html-widget { color: red; }', 'hero')).toBe('.hero html-widget { color: red; }');
  });

  it('passes @page through unchanged', () => {
    const input = '@page { size: 1920px 1080px; margin: 0; }';
    expect(scopeCSS(input, 'hero')).toBe(input);
  });

  it('does not scope root selectors inside @media blocks', () => {
    const input = '@media (min-width: 40rem) {\nbody { padding: 0; }\n}';
    const result = scopeCSS(input, 'hero');
    expect(result).toContain('body { padding: 0; }');
    expect(result).not.toContain('.hero body');
  });

  it('still scopes normal selectors inside @media blocks', () => {
    const input = '@media (min-width: 40rem) {\nh1 { font-size: 2rem; }\n}';
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

  it('leaves root and :global selectors in component CSS unscoped', () => {
    const deck: Component = {
      name: 'deck',
      template: '',
      css: 'body { display: flex; }\n:global(.leaflet-container) { z-index: 1; }\n@page { margin: 0; }',
      schema: {},
    };
    const result = assemblePageCSS([deck], '');
    expect(result).toContain('body { display: flex; }');
    expect(result).toContain('.leaflet-container { z-index: 1; }');
    expect(result).toContain('@page { margin: 0; }');
    expect(result).not.toContain('.deck body');
  });
});
