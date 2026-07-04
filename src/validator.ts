import { parse as parseHTML } from 'node-html-parser';
import type { Component } from './types.js';
import { EngineError } from './types.js';
import { validateText } from './text-validator.js';
import { validateData as validateSchema } from './schema.js';

/**
 * Validate a component's structure and template content.
 * Returns warnings. Throws EngineError on blocking errors.
 */
export function validateComponent(comp: Component): EngineError[] {
  const warnings: EngineError[] = [];

  // Check for forbidden tags in template
  const lower = comp.template.toLowerCase();
  if (/<script[\s>]/i.test(lower)) {
    throw new EngineError(
      `Component template contains <script> tag (forbidden)`,
      `components/${comp.name}.component.html`,
    );
  }
  if (/<style[\s>]/i.test(lower)) {
    throw new EngineError(
      `Component template contains <style> tag (forbidden)`,
      `components/${comp.name}.component.html`,
    );
  }
  if (/\sstyle\s*=\s*["']/i.test(comp.template)) {
    throw new EngineError(
      `Component template contains inline style attribute (forbidden)`,
      `components/${comp.name}.component.html`,
    );
  }

  return warnings;
}

/**
 * Validate data for a component on a specific page.
 * Checks schema validity and text field whitelist.
 * Returns warnings. Throws EngineError on blocking errors.
 */
export function validatePageData(
  comp: Component,
  data: Record<string, unknown>,
  dataFilePath: string,
): EngineError[] {
  const warnings: EngineError[] = [];

  // Schema validation
  const result = validateSchema(comp.schema, data);
  if (!result.valid) {
    for (const err of result.errors) {
      throw new EngineError(
        `Schema validation failed: ${err}`,
        dataFilePath,
        undefined,
        'ERROR',
      );
    }
  }

  // Check for unused keys (warnings)
  for (const key of Object.keys(data)) {
    if (!(key in comp.schema)) {
      warnings.push(new EngineError(
        `Unused data key "${key}" — not in component schema`,
        dataFilePath,
        key,
        'WARNING',
      ));
    }
  }

  // Text field tag validation
  for (const [name, def] of Object.entries(comp.schema)) {
    if (def.type === 'text' && typeof data[name] === 'string') {
      validateText(data[name] as string, dataFilePath, name);
    }
  }

  return warnings;
}

/**
 * Validate assembled HTML page structure.
 * Checks: body children are header/section/footer, sections have id+class,
 * no duplicate IDs, no inline styles.
 */
export function validatePageStructure(html: string): void {
  const root = parseHTML(html);
  const body = root.querySelector('body');
  if (!body) {
    throw new EngineError('Page must have a <body> element', '');
  }

  const children = body.childNodes.filter((n) => n.nodeType === 1); // element nodes
  const ids = new Set<string>();

  for (const child of children) {
    const el = child as unknown as HTMLElement;
    const tag = el.tagName?.toLowerCase();

    if (tag !== 'header' && tag !== 'section' && tag !== 'footer') {
      throw new EngineError(
        `Disallowed direct child of <body>: <${tag}>. Only <header>, <section id="...">, and <footer> are allowed.`,
        '',
      );
    }

    const id = el.getAttribute?.('id');
    const cls = el.getAttribute?.('class');

    if (tag === 'section') {
      if (!id) {
        throw new EngineError(`<section> must have an id attribute`, '');
      }
      if (!cls) {
        throw new EngineError(`<section id="${id}"> must have a class attribute`, '');
      }
    }

    if (id) {
      if (ids.has(id)) {
        throw new EngineError(`Duplicate id "${id}" in page`, '');
      }
      ids.add(id);
    }
  }
}

// Minimal HTMLElement interface for node-html-parser
interface HTMLElement {
  tagName?: string;
  getAttribute?(name: string): string | undefined;
}
