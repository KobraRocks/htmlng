import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import type { Component, PlaceholderValue, ImageValue } from './types.js';
import { EngineError } from './types.js';
import { escapeHtml, escapeAttr } from './escape.js';
import { loadConfig } from './config.js';
import { parseComponent, findComponents } from './component.js';
import { renderTemplate } from './template.js';
import { assemblePageCSS } from './css.js';
import { loadData } from './data-file.js';
import { parsePage } from './page.js';
import { validateComponent, validatePageData, validatePageStructure } from './validator.js';

/**
 * Load every component in the components directory for `{{slot:...}}` resolution.
 * A malformed component that is not used by the page must not block rendering —
 * `htmlng validate` reports those separately.
 */
function loadAllComponents(compDir: string): Map<string, Component> {
  const map = new Map<string, Component>();
  for (const name of findComponents(compDir)) {
    try {
      map.set(name, parseComponent(join(compDir, `${name}.component.html`)));
    } catch {
      // Ignored here; surfaced by `htmlng validate`.
    }
  }
  return map;
}

/**
 * Render a full HTML page document.
 *
 * When a `warnings` array is supplied, non-blocking validation warnings are
 * appended to it so the caller can display them (and `--strict` can fail).
 */
export function renderPage(
  rootDir: string,
  pageName: string,
  inlineCSS = false,
  warnings: EngineError[] = [],
): string {
  const config = loadConfig(rootDir);
  const pagePath = join(rootDir, config.paths.pages, `${pageName}.page.yaml`);
  const page = parsePage(pagePath);

  if (page.components.length === 0) {
    throw new EngineError(`Page "${pageName}" has no components`, pagePath, 'components', 'ERROR', undefined, 'PAGE_NO_COMPONENTS');
  }

  const compDir = join(rootDir, config.paths.components);

  // Full map so {{slot:...}} can reference any component, not only page members
  const allComponents = loadAllComponents(compDir);

  // Page components are parsed strictly so a missing file reports a clear error
  const pageComponents: Component[] = [];
  for (const name of page.components) {
    const comp = parseComponent(join(compDir, `${name}.component.html`));
    warnings.push(...validateComponent(comp));
    allComponents.set(name, comp);
    pageComponents.push(comp);
  }

  const requireAltText = config.validation.requireAltText;

  // Render each component (data may be a single object or an array of objects)
  const renderedComponents: Array<{ name: string; html: string; index?: number }> = [];
  for (const name of page.components) {
    const comp = allComponents.get(name)!;
    const data = loadData(rootDir, pageName, name);
    const dataPath = join(rootDir, config.paths.data, pageName, `${name}.yaml`);

    if (Array.isArray(data)) {
      // Array data — render one section per array element
      for (let i = 0; i < data.length; i++) {
        const item = data[i] as Record<string, PlaceholderValue>;
        warnings.push(...validatePageData(comp, item, dataPath, { requireAltText }));
        const innerHTML = renderTemplate(comp.template, item, allComponents);
        renderedComponents.push({ name, html: innerHTML, index: i });
      }
    } else {
      // Single object data — current behavior
      warnings.push(...validatePageData(comp, data as Record<string, PlaceholderValue>, dataPath, { requireAltText }));
      const innerHTML = renderTemplate(comp.template, data as Record<string, PlaceholderValue>, allComponents);
      renderedComponents.push({ name, html: innerHTML });
    }
  }

  // Read global CSS and resolve design tokens
  let globalCSS = readFileSync(join(rootDir, 'global.css'), 'utf-8');
  const tokens = loadDesignTokens(rootDir);
  globalCSS = resolveTokens(globalCSS, tokens);

  // Assemble CSS from the page's components only (not every component on disk)
  const pageCSS = assemblePageCSS(pageComponents, globalCSS);

  // Build HTML
  const lang = page.lang ?? config.project.lang;
  const viewport = page.viewport ?? 'width=device-width, initial-scale=1';

  let head = '';
  head += `  <meta charset="UTF-8">\n`;
  head += `  <title>${escapeHtml(page.title)}</title>\n`;
  head += `  <meta name="description" content="${escapeAttr(page.description)}">\n`;
  head += `  <meta name="viewport" content="${escapeAttr(viewport)}">\n`;
  if (page.favicon) {
    head += `  <link rel="icon" href="${escapeAttr(page.favicon)}">\n`;
  }
  if (page.head?.meta) {
    for (const m of page.head.meta) {
      head += `  <meta name="${escapeAttr(m.name)}" content="${escapeAttr(m.content)}">\n`;
    }
  }
  if (page.head?.link) {
    for (const l of page.head.link) {
      head += `  <link rel="${escapeAttr(l.rel)}" href="${escapeAttr(l.href)}">\n`;
    }
  }
  if (inlineCSS) {
    head += `  <style>\n${pageCSS}\n  </style>\n`;
  } else {
    head += `  <link rel="stylesheet" href="css/${pageName}.css">\n`;
  }

  // Scripts in head
  if (page.scripts) {
    for (const s of page.scripts) {
      if (s.head) {
        head += scriptTag(s);
      }
    }
  }

  // Body
  let body = '';
  for (let i = 0; i < renderedComponents.length; i++) {
    const { name, html, index } = renderedComponents[i];
    const idSuffix = index !== undefined ? `-${index}` : '';
    const id = `id="${escapeAttr(name)}${idSuffix}"`;
    const cls = `class="${escapeAttr(name)}"`;

    if (i === 0) {
      body += `  <header ${id} ${cls}>\n${indent(html, 4)}\n  </header>\n`;
    } else if (i === renderedComponents.length - 1 && name === 'footer') {
      body += `  <footer ${id} ${cls}>\n${indent(html, 4)}\n  </footer>\n`;
    } else {
      body += `  <section ${id} ${cls}>\n${indent(html, 4)}\n  </section>\n`;
    }
  }

  // Default footer only when the page defines no `footer` component at all.
  // (If a `footer` component exists but is not last, it is wrapped by position —
  // emitting a second `id="footer"` would fail the duplicate-id check.)
  const hasFooterComponent = renderedComponents.some((r) => r.name === 'footer');
  if (!hasFooterComponent) {
    const year = new Date().getFullYear();
    const projectName = config.project.name || 'Untitled';
    body += `  <footer id="footer" class="footer">\n    <p>&copy; ${year} ${escapeHtml(projectName)}.</p>\n  </footer>\n`;
  }

  // Body scripts
  let bodyScripts = '';
  if (page.scripts) {
    for (const s of page.scripts) {
      if (!s.head) {
        bodyScripts += `  ${scriptTag(s)}\n`;
      }
    }
  }

  const html = `<!DOCTYPE html>\n<html lang="${escapeAttr(lang)}">\n<head>\n${head}</head>\n<body>\n${body}${bodyScripts}</body>\n</html>`;

  // Validate structure
  validatePageStructure(html);

  return html;
}

/**
 * Render a single component's inner HTML with data from a specific page.
 * No wrapping element. Returns only the resolved template.
 *
 * The full component map is loaded so `{{slot:...}}` resolves to sibling
 * components, keeping the per-component feedback loop usable (spec C17).
 */
export function renderComponent(
  rootDir: string,
  componentName: string,
  pageName: string,
  warnings: EngineError[] = [],
): string {
  const config = loadConfig(rootDir);
  const compDir = join(rootDir, config.paths.components);
  const comp = parseComponent(join(compDir, `${componentName}.component.html`));

  const allComponents = loadAllComponents(compDir);
  allComponents.set(componentName, comp);

  warnings.push(...validateComponent(comp));

  const data = loadData(rootDir, pageName, componentName);
  const dataPath = join(rootDir, config.paths.data, pageName, `${componentName}.yaml`);
  const requireAltText = config.validation.requireAltText;

  if (Array.isArray(data)) {
    // Render each array element separated by dividers
    const parts: string[] = [];
    for (let i = 0; i < data.length; i++) {
      const item = data[i] as Record<string, PlaceholderValue>;
      warnings.push(...validatePageData(comp, item, dataPath, { requireAltText }));
      const innerHTML = renderTemplate(comp.template, item, allComponents);
      if (data.length > 1) {
        parts.push(`=== ITEM ${i} ===\n${innerHTML}`);
      } else {
        parts.push(innerHTML);
      }
    }
    return parts.join('\n');
  }

  warnings.push(...validatePageData(comp, data as Record<string, PlaceholderValue>, dataPath, { requireAltText }));
  return renderTemplate(comp.template, data as Record<string, PlaceholderValue>, allComponents);
}

/**
 * Render a component with auto-generated sample data from its schema.
 */
export function previewComponent(rootDir: string, componentName: string): string {
  const config = loadConfig(rootDir);
  const compPath = join(rootDir, config.paths.components, `${componentName}.component.html`);
  const comp = parseComponent(compPath);

  const sampleData: Record<string, PlaceholderValue> = {};
  for (const [name, def] of Object.entries(comp.schema)) {
    switch (def.type) {
      case 'text':
        sampleData[name] = `Sample ${name}`;
        break;
      case 'html':
        sampleData[name] = `<p>Sample ${name} content</p>`;
        break;
      case 'bool':
        sampleData[name] = true;
        break;
      case 'image':
        sampleData[name] = { src: 'assets/images/sample.webp', alt: 'Sample alt text' } as ImageValue;
        break;
      case 'link':
        sampleData[name] = { href: '#', label: `Sample ${name}` };
        break;
      case 'list':
        sampleData[name] = [{ title: `Sample ${name} item` }] as unknown as PlaceholderValue;
        break;
      case 'slot':
        sampleData[name] = { component: componentName };
        break;
    }
  }

  const allComponents = loadAllComponents(join(rootDir, config.paths.components));
  allComponents.set(componentName, comp);

  return renderTemplate(comp.template, sampleData, allComponents);
}

// ── Helpers ─────────────────────────────────────────────

function scriptTag(s: { src: string; defer?: boolean; async?: boolean; type?: string }): string {
  const attrs: string[] = [`src="${escapeAttr(s.src)}"`];
  if (s.defer) attrs.push('defer');
  if (s.async) attrs.push('async');
  if (s.type) attrs.push(`type="${escapeAttr(s.type)}"`);
  return `<script ${attrs.join(' ')}></script>`;
}

function indent(html: string, spaces: number): string {
  const prefix = ' '.repeat(spaces);
  return html.split('\n').map((line) => prefix + line).join('\n');
}

export function loadDesignTokens(rootDir: string): Record<string, string> {
  const path = join(rootDir, 'design-tokens.yaml');
  if (!existsSync(path)) return {};
  try {
    const raw = load(readFileSync(path, 'utf-8')) as Record<string, unknown>;
    const tokens: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) { tokens[k] = String(v); }
    return tokens;
  } catch { return {}; }
}

export function resolveTokens(css: string, tokens: Record<string, string>): string {
  return css.replace(/\{\{\s*([\w-]+)\s*\}\}/g, (_, name) => tokens[name] ?? `{{${name}}}`);
}
