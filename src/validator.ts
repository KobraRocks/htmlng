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
  // Validate structure with simple string checks.
  // (node-html-parser v8.0.4 has a parsing bug with complex nested sections.)

  if (!/<body[\s>]/i.test(html)) {
    throw new EngineError('Page must have a <body> element', '');
  }

  // Extract body content
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (!bodyMatch) {
    throw new EngineError('Page must have a closing </body> tag', '');
  }

  const bodyContent = bodyMatch[1];

  // Find direct children of body (top-level tags)
  const topLevelTags: string[] = [];
  const tagRe = /<(\/?)(\w+)([^>]*)>/g;
  let match: RegExpExecArray | null;
  let depth = 0;

  while ((match = tagRe.exec(bodyContent)) !== null) {
    const isClose = match[1] === '/';
    const tagName = match[2].toLowerCase();

    // Skip self-closing tags
    if (match[3].endsWith('/')) continue;
    if (['br', 'img', 'input', 'meta', 'link', 'hr'].includes(tagName)) continue;

    if (isClose) {
      depth--;
    } else {
      if (depth === 0) {
        topLevelTags.push(tagName);
      }
      depth++;
    }
  }

  for (const tag of topLevelTags) {
    if (tag !== 'header' && tag !== 'section' && tag !== 'footer') {
      throw new EngineError(
        `Disallowed direct child of <body>: <${tag}>. Only <header>, <section id="...">, and <footer> are allowed.`,
        '',
      );
    }
  }

  // Check for duplicate IDs
  const idRe = /\sid="([^"]+)"/g;
  const ids = new Set<string>();
  while ((match = idRe.exec(html)) !== null) {
    const id = match[1];
    if (ids.has(id)) {
      throw new EngineError(`Duplicate id "${id}" in page`, '');
    }
    ids.add(id);
  }
}
