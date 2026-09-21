import { readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { Component, PlaceholderSchema } from './types.js';
import { EngineError } from './types.js';

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
    throw new EngineError(`Component file not found: ${filePath}`, filePath);
  }

  const sections = splitSections(content);
  if (sections.length < 2) {
    throw new EngineError(
      `Component file must have at least template and schema sections separated by "---"`,
      filePath,
    );
  }
  if (sections.length > 3) {
    throw new EngineError(
      `Component file has ${sections.length} sections; expected template, optional CSS, and schema (separated by "---" lines)`,
      filePath,
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
    );
  }

  // Validate schema entries have valid types
  const validTypes = new Set(['text', 'html', 'image', 'link', 'list', 'bool', 'slot']);
  for (const [name, def] of Object.entries(schema)) {
    if (!validTypes.has(def.type)) {
      throw new EngineError(
        `Invalid placeholder type "${def.type}" for "${name}". Must be one of: ${[...validTypes].join(', ')}`,
        filePath,
        name,
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
