import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import type { Component, Page, PlaceholderValue, ImageValue } from './types.js';
import { EngineError } from './types.js';
import { escapeHtml, escapeAttr } from './escape.js';
import { loadConfig } from './config.js';
import { parseComponent } from './component.js';
import { renderTemplate } from './template.js';
import { assemblePageCSS } from './css.js';
import { loadData } from './data-file.js';
import { parsePage } from './page.js';
import { validateComponent, validatePageData, validatePageStructure } from './validator.js';

/**
 * Render a full HTML page document.
 */
export function renderPage(rootDir: string, pageName: string, inlineCSS = false): string {
  const config = loadConfig(rootDir);
  const pagePath = join(rootDir, config.paths.pages, `${pageName}.page.yaml`);
  const page = parsePage(pagePath);

  if (page.components.length === 0) {
    throw new EngineError(`Page "${pageName}" has no components`, pagePath, 'components');
  }

  // Parse all components and build the lookup map
  const allComponents = new Map<string, Component>();
  for (const name of page.components) {
    const compPath = join(rootDir, config.paths.components, `${name}.component.html`);
    const comp = parseComponent(compPath);

    // Validate component
    const compWarnings = validateComponent(comp);
    // warnings are collected but don't block

    allComponents.set(name, comp);
  }

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
        validatePageData(comp, item, dataPath);
        const innerHTML = renderTemplate(comp.template, item, allComponents);
        renderedComponents.push({ name, html: innerHTML, index: data.length > 1 ? i : undefined });
      }
    } else {
      // Single object data — current behavior
      validatePageData(comp, data as Record<string, PlaceholderValue>, dataPath);
      const innerHTML = renderTemplate(comp.template, data as Record<string, PlaceholderValue>, allComponents);
      renderedComponents.push({ name, html: innerHTML });
    }
  }

  // Read global CSS and resolve design tokens
  let globalCSS = readFileSync(join(rootDir, 'global.css'), 'utf-8');
  const tokens = loadDesignTokens(rootDir);
  globalCSS = resolveTokens(globalCSS, tokens);

  // Assemble CSS
  const compsArray = Array.from(allComponents.values());
  const pageCSS = assemblePageCSS(compsArray, globalCSS);

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

  // Default footer if last component isn't "footer"
  const lastComp = renderedComponents[renderedComponents.length - 1];
  if (lastComp.name !== 'footer') {
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
 */
export function renderComponent(rootDir: string, componentName: string, pageName: string): string {
  const config = loadConfig(rootDir);
  const compPath = join(rootDir, config.paths.components, `${componentName}.component.html`);
  const comp = parseComponent(compPath);
  const data = loadData(rootDir, pageName, componentName);
  const allComponents = new Map<string, Component>();
  allComponents.set(componentName, comp);

  validateComponent(comp);
  const dataPath = join(rootDir, config.paths.data, pageName, `${componentName}.yaml`);

  if (Array.isArray(data)) {
    // Render each array element separated by dividers
    const parts: string[] = [];
    for (let i = 0; i < data.length; i++) {
      const item = data[i] as Record<string, PlaceholderValue>;
      validatePageData(comp, item, dataPath);
      const innerHTML = renderTemplate(comp.template, item, allComponents);
      if (data.length > 1) {
        parts.push(`=== ITEM ${i} ===\n${innerHTML}`);
      } else {
        parts.push(innerHTML);
      }
    }
    return parts.join('\n');
  }

  validatePageData(comp, data as Record<string, PlaceholderValue>, dataPath);
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

  const allComponents = new Map<string, Component>();
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
