import type { Component } from './types.js';
import { EngineError } from './types.js';
import { validateText } from './text-validator.js';
import { validateData as validateSchema } from './schema.js';
import { unsafeUrlReason } from './url-safety.js';

/**
 * Validate a component's structure and template content.
 * Returns warnings. Throws EngineError on blocking errors.
 */
export function validateComponent(comp: Component): EngineError[] {
  const warnings: EngineError[] = [];

  const file = `components/${comp.name}.component.html`;

  // Check for forbidden tags in template
  const lower = comp.template.toLowerCase();
  if (/<script[\s>]/i.test(lower)) {
    throw new EngineError(
      `Component template contains <script> tag (forbidden)`,
      file, undefined, 'ERROR', undefined, 'COMPONENT_SCRIPT_FORBIDDEN',
    );
  }
  if (/<style[\s>]/i.test(lower)) {
    throw new EngineError(
      `Component template contains <style> tag (forbidden)`,
      file, undefined, 'ERROR', undefined, 'COMPONENT_STYLE_FORBIDDEN',
    );
  }
  if (/\sstyle\s*=\s*["']/i.test(comp.template)) {
    throw new EngineError(
      `Component template contains inline style attribute (forbidden)`,
      file, undefined, 'ERROR', undefined, 'COMPONENT_INLINE_STYLE',
    );
  }

  // Cross-validate template placeholders against schema.
  // `scopedNames` = names that must exist in the schema (top-level, block names,
  // and placeholders inside if/unless blocks). `usedNames` = every name in the
  // template, so a field used only inside a list block still counts as used.
  const scopedNames = collectScopedNames(comp.template);
  const usedNames = collectUsedNames(comp.template);
  const schemaFields = new Set(Object.keys(comp.schema));

  for (const field of scopedNames) {
    if (!schemaFields.has(field)) {
      throw new EngineError(
        `Template uses placeholder "${field}" but schema has no matching entry. ` +
        `Add "${field}" to the schema section, or update the template.`,
        file, field, 'ERROR', undefined, 'TEMPLATE_PLACEHOLDER_UNKNOWN',
      );
    }
  }

  // Element placeholders emit a whole element and cannot be an attribute value
  const elementPlaceholder = findElementPlaceholderInAttribute(comp.template);
  if (elementPlaceholder) {
    throw new EngineError(
      `Placeholder {{${elementPlaceholder}:...}} is used inside an attribute value, but it emits a whole element`,
      file, undefined, 'ERROR',
      `Use the placeholder as element content instead, e.g. <span class="logo">{{${elementPlaceholder}:name}}</span>.`,
      'COMPONENT_PLACEHOLDER_IN_ATTRIBUTE',
    );
  }

  for (const field of schemaFields) {
    if (!usedNames.has(field)) {
      warnings.push(new EngineError(
        `Schema defines "${field}" but template does not use it. ` +
        `Remove from schema or add {{...${field}}} to the template.`,
        file, field, 'WARNING', undefined, 'SCHEMA_FIELD_UNUSED',
      ));
    }
  }

  // Warn about an outer div that duplicates the engine's own semantic wrapper
  if (isRedundantWrapper(comp.template, comp.name)) {
    warnings.push(new EngineError(
      `Template wraps its content in <div class="${comp.name}">, duplicating the engine wrapper`,
      file,
      undefined,
      'WARNING',
      `The engine already emits the wrapper (id/class "${comp.name}"). Remove the outer <div> and keep the inner content.`,
      'COMPONENT_REDUNDANT_WRAPPER',
    ));
  }

  return warnings;
}

/** True when the template is a single `<div class="<name>">…</div>` wrapper. */
function isRedundantWrapper(template: string, name: string): boolean {
  const trimmed = template.trim();
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const openRe = new RegExp(`^<div\\s+class=["']${escaped}["']\\s*>`, 'i');
  return openRe.test(trimmed) && trimmed.toLowerCase().endsWith('</div>');
}

interface PlaceholderToken {
  kind: 'open' | 'close' | 'inline';
  type: string;
  name: string;
}

function tokenizePlaceholders(template: string): PlaceholderToken[] {
  const re = /\{\{\s*(\/?)\s*(#)?\s*(\w+)\s*:\s*(\w+)\s*\}\}/g;
  const tokens: PlaceholderToken[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(template)) !== null) {
    tokens.push({
      kind: m[1] === '/' ? 'close' : m[2] === '#' ? 'open' : 'inline',
      type: m[3],
      name: m[4],
    });
  }
  return tokens;
}

/**
 * Names that must exist in the component schema: top-level placeholders, block
 * names, and placeholders inside `if`/`unless` blocks (which share the component
 * scope). Names inside `list` blocks are excluded — they resolve against the list
 * item, not the component schema.
 */
function collectScopedNames(template: string): Set<string> {
  const names = new Set<string>();
  const stack: string[] = [];
  for (const t of tokenizePlaceholders(template)) {
    const inList = stack.includes('list');
    if (t.kind === 'open') {
      if (!inList) names.add(t.name);
      stack.push(t.type);
    } else if (t.kind === 'close') {
      const idx = stack.lastIndexOf(t.type);
      if (idx !== -1) stack.length = idx;
    } else if (!inList) {
      names.add(t.name);
    }
  }
  return names;
}

/** Every placeholder name appearing anywhere in the template, in any scope. */
function collectUsedNames(template: string): Set<string> {
  const names = new Set<string>();
  for (const t of tokenizePlaceholders(template)) names.add(t.name);
  return names;
}

const ATTRIBUTE_VALUE_RE = /[a-zA-Z_:][-a-zA-Z0-9_:.]*\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
const ELEMENT_PLACEHOLDER_RE = /\{\{\s*(image|link|slot)\s*:/;

/**
 * Find an element-emitting placeholder (`image`, `link`, `slot`) used as an
 * attribute value — quoted or unquoted. The renderer replaces it with a whole
 * element, which would otherwise land inside the attribute and silently corrupt
 * the markup.
 */
function findElementPlaceholderInAttribute(template: string): string | null {
  ATTRIBUTE_VALUE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTRIBUTE_VALUE_RE.exec(template)) !== null) {
    const value = m[1] ?? m[2] ?? m[3] ?? '';
    const ph = value.match(ELEMENT_PLACEHOLDER_RE);
    if (ph) return ph[1];
  }
  return null;
}

export interface PageDataValidationOptions {
  /** Enforce that every image value provides an `alt` string (spec §7.3). */
  requireAltText?: boolean;
  /** Component map — enables recursive validation of `{{slot}}` sub-data. */
  components?: Map<string, Component>;
  /** @internal slot recursion depth */
  slotDepth?: number;
  /** @internal components visited along the slot chain */
  slotVisited?: Set<string>;
  /** 0-based element index when validating one element of an array data file. */
  itemIndex?: number;
}

/**
 * Validate data for a component on a specific page.
 * Checks schema validity, alt text, and the text field whitelist.
 * Returns warnings. Throws EngineError on blocking errors.
 */
export function validatePageData(
  comp: Component,
  data: Record<string, unknown>,
  dataFilePath: string,
  options: PageDataValidationOptions = {},
): EngineError[] {
  const warnings: EngineError[] = [];

  // Element context for array data files: "element [3] /body must ..." makes a
  // repeated component's failing element identifiable without manual bisection.
  const where = options.itemIndex !== undefined ? `element [${options.itemIndex}] ` : '';

  // Schema validation — report every problem at once so one pass is enough to fix
  const result = validateSchema(comp.schema, data);
  if (!result.valid) {
    // A map whose keys are entirely absent from the schema is the classic
    // "I meant to repeat the component" mistake — say so instead of only
    // listing the missing required fields.
    const dataKeys = Object.keys(data);
    const disjoint = dataKeys.length > 0 &&
      dataKeys.every((k) => !Object.prototype.hasOwnProperty.call(comp.schema, k));
    const help = disjoint
      ? 'This data file is a YAML map, but none of its keys exist in the schema. To repeat the component, make it a YAML sequence (a list) with one element per instance and the schema fields at the top level of each element.'
      : undefined;
    throw new EngineError(
      `Schema validation failed: ${result.errors.map((e) => `${where}${e}`).join('; ')}`,
      dataFilePath,
      undefined,
      'ERROR',
      help,
      'SCHEMA_VALIDATION',
    );
  }

  // Check for unused keys (warnings)
  for (const key of Object.keys(data)) {
    if (!(key in comp.schema)) {
      warnings.push(new EngineError(
        `Unused data key "${key}" — not in component schema`,
        dataFilePath,
        key,
        'WARNING',
        undefined,
        'DATA_KEY_UNUSED',
      ));
    }
  }

  // Alt text enforcement (spec §7.3). An empty alt is allowed (decorative),
  // but the key must be present when validation.requireAltText is on.
  if (options.requireAltText) {
    for (const [name, def] of Object.entries(comp.schema)) {
      if (def.type !== 'image') continue;
      const value = data[name];
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const alt = (value as Record<string, unknown>).alt;
        if (typeof alt !== 'string') {
          throw new EngineError(
            `${where}Image "${name}" is missing alt text`,
            dataFilePath,
            name,
            'ERROR',
            'Add "alt:" to the image data, or set validation.requireAltText: false in engine.config.yaml.',
            'ALT_TEXT_REQUIRED',
          );
        }
      }
    }
  }

  // URL scheme safety for link/image values
  for (const [name, def] of Object.entries(comp.schema)) {
    const value = data[name];
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const record = value as Record<string, unknown>;

    if (def.type === 'link' && typeof record.href === 'string') {
      const reason = unsafeUrlReason(record.href);
      if (reason) {
        throw new EngineError(
          `${where}Unsafe link href in "${name}": ${reason}`,
          dataFilePath, name, 'ERROR',
          'Use an http(s), mailto, tel, fragment (#...), or relative URL.',
          'UNSAFE_URL',
        );
      }
    }

    if (def.type === 'image' && typeof record.src === 'string') {
      const reason = unsafeUrlReason(record.src, { allowDataImage: true });
      if (reason) {
        throw new EngineError(
          `${where}Unsafe image src in "${name}": ${reason}`,
          dataFilePath, name, 'ERROR',
          'Use a path/URL, or a raster data:image/<type> URL.',
          'UNSAFE_URL',
        );
      }
    }
  }

  // Recurse into {{slot}} sub-data so inline slots cannot bypass the schema,
  // URL, alt-text, or text-whitelist checks
  if (options.components) {
    for (const [name, def] of Object.entries(comp.schema)) {
      if (def.type !== 'slot') continue;
      const value = data[name];
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const record = value as Record<string, unknown>;
      const componentName = record.component;
      if (typeof componentName !== 'string') continue; // schema already requires it

      const nested = options.components.get(componentName);
      if (!nested) {
        throw new EngineError(
          `Slot references unknown component: ${componentName}`,
          dataFilePath, name, 'ERROR', undefined, 'SLOT_UNKNOWN_COMPONENT',
        );
      }

      const depth = (options.slotDepth ?? 0) + 1;
      if (depth > 3) {
        throw new EngineError('Slot nesting depth exceeds maximum (3)', dataFilePath, name, 'ERROR', undefined, 'SLOT_DEPTH_EXCEEDED');
      }
      const visited = new Set(options.slotVisited ?? []);
      if (visited.has(componentName)) {
        throw new EngineError(`Circular slot reference: ${componentName}`, dataFilePath, name, 'ERROR', undefined, 'SLOT_CIRCULAR');
      }
      visited.add(componentName);

      const slotData = record.data;
      if (slotData !== undefined && (typeof slotData !== 'object' || slotData === null || Array.isArray(slotData))) {
        throw new EngineError(
          `Slot data for "${name}" must be an object`,
          dataFilePath, name, 'ERROR', undefined, 'SCHEMA_VALIDATION',
        );
      }

      warnings.push(...validatePageData(
        nested,
        (slotData ?? {}) as Record<string, unknown>,
        dataFilePath,
        { ...options, slotDepth: depth, slotVisited: visited },
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
  // Structural checks are string-based on purpose: the engine only inspects
  // markup it generated itself, and a dependency-free check keeps the output
  // deterministic (issue 06 — the HTML parser dependency was removed).

  if (!/<body[\s>]/i.test(html)) {
    throw new EngineError('Page must have a <body> element', '', undefined, 'ERROR', undefined, 'PAGE_NO_BODY');
  }

  // Extract body content
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (!bodyMatch) {
    throw new EngineError('Page must have a closing </body> tag', '', undefined, 'ERROR', undefined, 'PAGE_BODY_UNCLOSED');
  }

  const bodyContent = bodyMatch[1];

  // Find direct children of body (top-level tags)
  const topLevelTags: Array<{ tag: string; attrs: string }> = [];
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
        topLevelTags.push({ tag: tagName, attrs: match[3] });
      }
      depth++;
    }
  }

  for (const { tag, attrs } of topLevelTags) {
    if (tag === 'header' || tag === 'section' || tag === 'footer') continue;
    // Page scripts belong at the end of <body> so the DOM exists when they run
    if (tag === 'script') continue;
    // The optional page-level layout container (layout.wrapper: true).
    // `(?:^|\s)` keeps `data-id="page"` from matching.
    if (tag === 'div' && /(?:^|\s)id\s*=\s*["']page["']/.test(attrs)) continue;
    throw new EngineError(
      `Disallowed direct child of <body>: <${tag}>. Allowed: <header>, <section id="...">, <footer>, <script>, and one <div id="page"> layout wrapper.`,
      '',
      undefined,
      'ERROR',
      undefined,
      'PAGE_BODY_CHILD',
    );
  }

  // Check for duplicate IDs
  const idRe = /\sid="([^"]+)"/g;
  const ids = new Set<string>();
  while ((match = idRe.exec(html)) !== null) {
    const id = match[1];
    if (ids.has(id)) {
      throw new EngineError(`Duplicate id "${id}" in page`, '', undefined, 'ERROR', undefined, 'PAGE_DUPLICATE_ID');
    }
    ids.add(id);
  }
}
