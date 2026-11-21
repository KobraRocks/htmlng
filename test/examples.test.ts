import { describe, it, expect } from 'vitest';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { renderPage } from '../src/renderer.js';
import { parsePage, findPages } from '../src/page.js';
import { findComponents } from '../src/component.js';
import type { EngineError } from '../src/types.js';

const EXAMPLES = join(import.meta.dirname, '..', 'examples');

const projects = existsSync(EXAMPLES)
  ? readdirSync(EXAMPLES, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  : [];

describe('examples', () => {
  it('ships at least one runnable example project', () => {
    expect(projects.length).toBeGreaterThan(0);
  });

  for (const project of projects) {
    describe(`examples/${project}`, () => {
      const root = join(EXAMPLES, project);

      it('has components, pages, and data', () => {
        expect(findComponents(join(root, 'components')).length).toBeGreaterThan(0);
        expect(findPages(join(root, 'pages')).length).toBeGreaterThan(0);
      });

      it('renders every page without warnings', () => {
        for (const pageName of findPages(join(root, 'pages'))) {
          const warnings: EngineError[] = [];
          const html = renderPage(root, pageName, false, warnings);
          expect(html, `${project}/${pageName}`).toContain('<!DOCTYPE html>');
          expect(
            warnings.map((w) => w.format()),
            `${project}/${pageName} should be warning-free`,
          ).toEqual([]);
        }
      });

      it('assembles semantic body structure', () => {
        for (const pageName of findPages(join(root, 'pages'))) {
          const page = parsePage(join(root, 'pages', `${pageName}.page.yaml`));
          const html = renderPage(root, pageName);
          // Wrapper role is name-based: header -> <header>, footer -> <footer>,
          // everything else -> <section>.
          for (const name of page.components) {
            const tag = name === 'header' ? 'header' : name === 'footer' ? 'footer' : 'section';
            expect(html, `${project}/${pageName}`).toContain(`<${tag} id="${name}"`);
          }
          // The page name is always the first <body> class; layout.bodyClass may add more.
          expect(html).toContain(`<body class="${pageName}`);
          expect(html).toContain(`data-page="${pageName}"`);
        }
      });

      it('emits no unresolved design tokens in the assembled CSS', () => {
        for (const pageName of findPages(join(root, 'pages'))) {
          const html = renderPage(root, pageName, true);
          expect(html).not.toMatch(/\{\{[a-z-]+\}\}/);
        }
      });
    });
  }
});
