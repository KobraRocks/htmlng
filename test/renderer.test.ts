import { describe, it, expect } from 'vitest';
import { renderPage, renderComponent, previewComponent } from '../src/renderer.js';
import { join } from 'node:path';

const FIXTURES = join(import.meta.dirname, 'fixtures');

describe('renderPage', () => {
  it('renders a full HTML page with name-based semantic wrappers', () => {
    const html = renderPage(FIXTURES, 'index');
    expect(html).toContain('<!DOCTYPE html>');
    // Wrapper role comes from the component name, not its position.
    expect(html).toContain('<section id="hero" class="hero">');
    expect(html).toContain('<section id="features" class="features">');
    expect(html).toContain('<footer id="footer" class="footer">');
    expect(html).toContain('<h1>Hello World</h1>');
  });

  it('gives <body> a page identity', () => {
    const html = renderPage(FIXTURES, 'index');
    expect(html).toContain('<body class="index" data-page="index">');
  });

  it('includes head elements', () => {
    const html = renderPage(FIXTURES, 'index');
    expect(html).toContain('<title>Test Page</title>');
    expect(html).toContain('<link rel="stylesheet" href="css/index.css">');
    expect(html).toContain('<meta charset="UTF-8">');
  });
});

describe('renderComponent', () => {
  it('renders inner HTML without wrapper', () => {
    const html = renderComponent(FIXTURES, 'hero', 'index');
    expect(html).toContain('<h1>Hello World</h1>');
    expect(html).not.toContain('<header');
    expect(html).not.toContain('<!DOCTYPE');
  });
});

describe('previewComponent', () => {
  it('renders with sample data', () => {
    const html = previewComponent(FIXTURES, 'hero');
    expect(html).toContain('Sample heading');
    expect(html).toContain('Sample subtext');
  });
});
