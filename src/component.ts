import { readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { Component, PlaceholderSchema } from './types.js';
import { EngineError, PLACEHOLDER_TYPES } from './types.js';

const COMPONENT_SUFFIX = '.component.html';
const SECTION_SEPARATOR = /^[ \t]*---[ \t]*$/;

/**
 * Split a component file into sections on lines that are exactly `---`
 * (allowing surrounding whitespace). Tolerates CRLF line endings and an
 * empty CSS section (two consecutive separators).
 */
function splitSections(content: string): string[] {
  const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const sections: string[][] = [[]];

  for (const line of normalized.split('\n')) {
    if (SECTION_SEPARATOR.test(line)) sections.push([]);
    else sections[sections.length - 1].push(line);
  }

  // A trailing separator (or trailing blank lines) is not a real section.
  while (sections.length > 1 && sections[sections.length - 1].every((l) => l.trim() === '')) {
    sections.pop();
  }

  return sections.map((lines) => lines.join('\n'));
}

export function parseComponent(filePath: string): Component {
  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    throw new EngineError(`Component file not found: ${filePath}`, filePath, undefined, 'ERROR', undefined, 'COMPONENT_NOT_FOUND');
  }

  const sections = splitSections(content);
  if (sections.length < 2) {
    throw new EngineError(
      `Component file must have at least template and schema sections separated by "---"`,
      filePath,
      undefined,
      'ERROR',
      undefined,
      'COMPONENT_SECTIONS_MISSING',
    );
  }
  if (sections.length > 3) {
    throw new EngineError(
      `Component file has ${sections.length} sections; expected template, optional CSS, and schema (separated by "---" lines)`,
      filePath,
      undefined,
      'ERROR',
      undefined,
      'COMPONENT_SECTIONS_EXCESS',
    );
  }

  const template = sections[0].trim();
  const css = sections.length >= 3 ? sections[1].trim() : '';
  const schemaRaw = (sections.length >= 3 ? sections[2] : sections[1]).trim();

  let schema: PlaceholderSchema;
  try {
    schema = JSON.parse(schemaRaw) as PlaceholderSchema;
  } catch {
    throw new EngineError(
      `Invalid JSON in component schema section`,
      filePath,
      undefined,
      'ERROR',
      undefined,
      'COMPONENT_SCHEMA_JSON',
    );
  }

  // Validate schema entries have valid types
  const validTypes = new Set<string>(PLACEHOLDER_TYPES);
  for (const [name, rawDef] of Object.entries(schema)) {
    if (typeof rawDef !== 'object' || rawDef === null || Array.isArray(rawDef)) {
      throw new EngineError(
        `Schema entry "${name}" must be an object like {"type":"text"}`,
        filePath,
        name,
        'ERROR',
        undefined,
        'COMPONENT_PLACEHOLDER_TYPE',
      );
    }

    const def = rawDef as { type?: unknown };
    if (typeof def.type !== 'string' || !validTypes.has(def.type)) {
      // A nested `"item": { ...fields }` is the intuitive shape for a repeating
      // list, but the engine does not support it — say so instead of "undefined".
      const isNestedItemSchema = def.type === undefined;
      const help = isNestedItemSchema
        ? 'Nested "item" schemas are not supported. For component repetition, make the data file a YAML sequence and declare the fields flat in the schema (the engine emits one wrapper per element). For a list inside one instance, use {{#list:name}} with the item fields read via {{text:field}}.'
        : undefined;
      throw new EngineError(
        isNestedItemSchema
          ? `Schema entry "${name}" has no "type" — nested item schemas are not supported`
          : `Invalid placeholder type "${String(def.type)}" for "${name}". Must be one of: ${PLACEHOLDER_TYPES.join(', ')}`,
        filePath,
        name,
        'ERROR',
        help,
        'COMPONENT_PLACEHOLDER_TYPE',
      );
    }
  }

  const name = basename(filePath, COMPONENT_SUFFIX);

  return { name, template, css, schema };
}

export function findComponents(dir: string): string[] {
  try {
    const files = readdirSync(dir);
    return files
      .filter((f) => f.endsWith(COMPONENT_SUFFIX))
      .map((f) => basename(f, COMPONENT_SUFFIX));
  } catch {
    return [];
  }
}
