import type { Component, PlaceholderValue, ImageValue, LinkValue, SlotValue } from './types.js';
import { EngineError } from './types.js';

export function renderTemplate(
  template: string,
  data: Record<string, PlaceholderValue>,
  components: Map<string, Component>,
  pageName: string,
  depth = 0,
  visited = new Set<string>(),
): string {
  // Tokenize: match all {{...}} tokens
  const TOKEN_RE = /\{\{\s*(\/?)\s*(#)?\s*(\w+)\s*:\s*(\w+)\s*\}\}/g;

  type Token =
    | { kind: 'text'; value: string }
    | { kind: 'inline'; type: string; name: string }
    | { kind: 'open'; type: string; name: string }
    | { kind: 'close'; type: string; name: string };

  const tokens: Token[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = TOKEN_RE.exec(template)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ kind: 'text', value: template.slice(lastIndex, match.index) });
    }

    const slash = match[1];   // "/" for closing, "" otherwise
    const hash = match[2];    // "#" for block open, undefined for others
    const type = match[3];    // "text", "html", "list", "bool", etc.
    const name = match[4];    // placeholder name

    if (slash === '/') {
      tokens.push({ kind: 'close', type, name });
    } else if (hash === '#') {
      tokens.push({ kind: 'open', type, name });
    } else {
      tokens.push({ kind: 'inline', type, name });
    }

    lastIndex = TOKEN_RE.lastIndex;
  }

  if (lastIndex < template.length) {
    tokens.push({ kind: 'text', value: template.slice(lastIndex) });
  }

  return walk(tokens, data, components, pageName, depth, visited);
}

// ── Tree walker — resolves tokens recursively ───────────

function walk(
  tokens: Array<{ kind: string; value?: string; type?: string; name?: string }>,
  data: Record<string, PlaceholderValue>,
  components: Map<string, Component>,
  pageName: string,
  depth: number,
  visited: Set<string>,
): string {
  let output = '';
  let i = 0;

  while (i < tokens.length) {
    const t = tokens[i];

    if (t.kind === 'text') {
      output += t.value ?? '';
      i++;
    } else if (t.kind === 'inline') {
      output += resolveInline(t.type!, t.name!, data, components, pageName, depth, visited);
      i++;
    } else if (t.kind === 'open') {
      // Find matching close
      const blockType = t.type!;
      const blockName = t.name!;
      let nest = 1;
      let j = i + 1;
      while (j < tokens.length && nest > 0) {
        if (tokens[j].kind === 'open' && tokens[j].type === blockType) nest++;
        if (tokens[j].kind === 'close' && tokens[j].type === blockType) nest--;
        j++;
      }
      if (nest !== 0) {
        throw new EngineError(`Unclosed block {{#${blockType}:${blockName}}}`, '', blockName);
      }

      const inner = tokens.slice(i + 1, j - 1);

      if (blockType === 'list') {
        output += resolveList(inner, blockName, data, components, pageName, depth, visited);
      } else if (blockType === 'bool') {
        output += resolveBool(inner, blockName, data, components, pageName, depth, visited);
      } else {
        throw new EngineError(`Unknown block type: {{#${blockType}:${blockName}}}`, '', blockName);
      }

      i = j;
    } else {
      // Unmatched close — skip
      i++;
    }
  }

  return output;
}

// ── Inline resolvers ────────────────────────────────────

function resolveInline(
  type: string,
  name: string,
  data: Record<string, PlaceholderValue>,
  components: Map<string, Component>,
  pageName: string,
  depth: number,
  visited: Set<string>,
): string {
  switch (type) {
    case 'text': {
      const v = data[name];
      return v !== undefined && v !== null ? String(v) : '';
    }
    case 'html': {
      const v = data[name];
      return v !== undefined && v !== null ? String(v) : '';
    }
    case 'image': {
      const v = data[name] as ImageValue | undefined;
      if (!v) return '';
      const attrs: string[] = [`src="${escapeAttr(v.src)}"`];
      if (v.alt) attrs.push(`alt="${escapeAttr(v.alt)}"`);
      if (v.width) attrs.push(`width="${v.width}"`);
      if (v.height) attrs.push(`height="${v.height}"`);
      if (v.loading) attrs.push(`loading="${v.loading}"`);
      if (v.class) attrs.push(`class="${escapeAttr(v.class)}"`);
      return `<img ${attrs.join(' ')}>`;
    }
    case 'link': {
      const v = data[name] as LinkValue | undefined;
      if (!v) return '';
      return `<a href="${escapeAttr(v.href)}">${escapeHtml(v.label)}</a>`;
    }
    case 'slot': {
      const v = data[name] as SlotValue | undefined;
      if (!v) return '';
      return resolveSlot(v, components, pageName, depth, visited);
    }
    default:
      throw new EngineError(`Unknown placeholder type: {{${type}:${name}}}`, '', name);
  }
}

// ── Block resolvers ─────────────────────────────────────

function resolveList(
  inner: Array<{ kind: string; value?: string; type?: string; name?: string }>,
  name: string,
  data: Record<string, PlaceholderValue>,
  components: Map<string, Component>,
  pageName: string,
  depth: number,
  visited: Set<string>,
): string {
  const list = data[name];
  if (!Array.isArray(list)) return '';

  let output = '';
  for (const item of list) {
    let scope: Record<string, PlaceholderValue>;
    if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
      scope = item as unknown as Record<string, PlaceholderValue>;
    } else {
      scope = { this: item as PlaceholderValue };
    }
    output += walk(inner, scope, components, pageName, depth, visited);
  }
  return output;
}

function resolveBool(
  inner: Array<{ kind: string; value?: string; type?: string; name?: string }>,
  name: string,
  data: Record<string, PlaceholderValue>,
  components: Map<string, Component>,
  pageName: string,
  depth: number,
  visited: Set<string>,
): string {
  if (data[name] === true) {
    return walk(inner, data, components, pageName, depth, visited);
  }
  return '';
}

// ── Slot resolver ───────────────────────────────────────

function resolveSlot(
  slotValue: SlotValue,
  components: Map<string, Component>,
  pageName: string,
  depth: number,
  visited: Set<string>,
): string {
  if (depth >= 3) {
    throw new EngineError(`Slot nesting depth exceeds maximum (3)`, '');
  }
  if (visited.has(slotValue.component)) {
    throw new EngineError(`Circular slot reference: ${slotValue.component}`, '');
  }

  const comp = components.get(slotValue.component);
  if (!comp) {
    throw new EngineError(`Slot references unknown component: ${slotValue.component}`, '');
  }

  const newVisited = new Set(visited);
  newVisited.add(slotValue.component);

  return renderTemplate(comp.template, slotValue.data ?? {}, components, pageName, depth + 1, newVisited);
}

// ── Escaping ────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;');
}
