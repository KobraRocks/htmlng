import type { Component } from './types.js';

const PASSTHROUGH_AT_RULES = new Set(['@keyframes', '@font-face', '@page']);

/**
 * Prefix every selector in CSS with ".className" (unless already prefixed).
 */
export function scopeCSS(css: string, className: string): string {
  if (!css.trim()) return '';
  const prefix = `.${className}`;

  // Strip comments
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');

  // Split into top-level blocks
  const blocks = splitBlocks(stripped);
  const out: string[] = [];

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    const atMatch = trimmed.match(/^(@[\w-]+)/);
    if (atMatch) {
      const atRule = atMatch[1];
      if (PASSTHROUGH_AT_RULES.has(atRule)) {
        out.push(trimmed);
      } else {
        // @media, @supports, etc. — scope selectors inside
        out.push(scopeAtRuleBlock(trimmed, prefix));
      }
    } else {
      out.push(scopeRuleBlock(trimmed, prefix));
    }
  }

  return out.join('\n');
}

/**
 * Assemble per-page CSS: global.css first, then scoped component CSS. Deduplicate.
 */
export function assemblePageCSS(components: Component[], globalCSS: string): string {
  const allBlocks: string[] = [];

  if (globalCSS.trim()) {
    for (const block of splitBlocks(globalCSS)) {
      if (block.trim()) allBlocks.push(block.trim());
    }
  }

  for (const comp of components) {
    if (comp.css.trim()) {
      for (const block of splitBlocks(comp.css)) {
        if (block.trim()) {
          const scoped = processBlock(block.trim(), `.${comp.name}`);
          if (scoped) allBlocks.push(scoped);
        }
      }
    }
  }

  // Normalize and deduplicate
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const block of allBlocks) {
    const norm = normalizeRule(block);
    if (norm && !seen.has(norm)) {
      seen.add(norm);
      deduped.push(block);
    }
  }

  return deduped.join('\n\n');
}

// ── Block-level helpers ─────────────────────────────────

function processBlock(block: string, prefix: string): string {
  const atMatch = block.match(/^(@[\w-]+)/);
  if (atMatch) {
    const atRule = atMatch[1];
    if (PASSTHROUGH_AT_RULES.has(atRule)) return block;
    return scopeAtRuleBlock(block, prefix);
  }
  return scopeRuleBlock(block, prefix);
}

function scopeRuleBlock(block: string, prefix: string): string {
  const braceIdx = block.indexOf('{');
  if (braceIdx === -1) return block;

  const sel = block.slice(0, braceIdx).trim();
  const body = block.slice(braceIdx);
  const scoped = prefixSelectors(sel, prefix);
  return scoped + ' ' + body;
}

function scopeAtRuleBlock(block: string, prefix: string): string {
  const firstBrace = block.indexOf('{');
  const lastBrace = block.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1) return block;

  const header = block.slice(0, firstBrace + 1);
  const inner = block.slice(firstBrace + 1, lastBrace);
  const closing = block.slice(lastBrace);

  // Scope each rule inside the at-rule body
  const innerBlocks = splitBlocks(inner);
  const scopedInner = innerBlocks
    .map((b) => processBlock(b.trim(), prefix))
    .filter(Boolean)
    .join('\n');

  return header + '\n' + scopedInner + '\n' + closing;
}

// A leading html/body/:root/:host (first compound only) already targets the
// document root, so a component prefix could never match it. The trailing
// character class excludes `-` so custom elements like `body-copy` stay scoped.
const ROOT_SELECTOR = /^(?:html|body|:root|:host)(?![A-Za-z0-9_-])/i;
const LEADING_GLOBAL_SELECTOR = /^:global\s*\(/;
const GLOBAL_SELECTOR = /:global\s*\(/;

function prefixSelectors(selectorList: string, prefix: string): string {
  return splitSelectorList(selectorList)
    .map((s) => scopeSelector(s.trim(), prefix))
    .join(', ');
}

/**
 * Split a selector list on top-level commas only: commas inside parentheses or
 * quoted attribute selectors (`[data-role="a,b"]`) are not separators.
 */
function splitSelectorList(selectorList: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;

  for (let i = 0; i < selectorList.length; i++) {
    const ch = selectorList[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth = Math.max(0, depth - 1);
    } else if (ch === ',' && depth === 0) {
      parts.push(selectorList.slice(start, i));
      start = i + 1;
    }
  }

  parts.push(selectorList.slice(start));
  return parts;
}

/** Replace every `:global(<sel>)` with `<sel>`, matching balanced parentheses. */
function unwrapGlobal(sel: string): string {
  let out = '';
  let i = 0;

  while (i < sel.length) {
    const idx = sel.indexOf(':global', i);
    if (idx === -1) {
      out += sel.slice(i);
      break;
    }
    out += sel.slice(i, idx);

    let j = idx + ':global'.length;
    while (j < sel.length && /\s/.test(sel[j])) j++;
    if (sel[j] !== '(') {
      out += sel.slice(idx, j);
      i = j;
      continue;
    }

    let depth = 1;
    let k = j + 1;
    for (; k < sel.length && depth > 0; k++) {
      if (sel[k] === '(') depth++;
      else if (sel[k] === ')') depth--;
    }
    if (depth !== 0) {
      // Unbalanced — leave the rest untouched rather than emit broken CSS.
      out += sel.slice(idx);
      break;
    }
    out += sel.slice(j + 1, k - 1).trim();
    i = k;
  }

  return out;
}

function scopeSelector(sel: string, prefix: string): string {
  // A leading :global(...) is the whole-selector escape hatch; unwrap it so a
  // document-wide selector is emitted unprefixed.
  if (LEADING_GLOBAL_SELECTOR.test(sel)) {
    const unwrapped = unwrapGlobal(sel);
    return unwrapped.trim() ? unwrapped : sel;
  }
  // A :global(...) later in the selector exempts only the wrapped compound;
  // the surrounding local compounds still belong to the component.
  const local = GLOBAL_SELECTOR.test(sel) ? unwrapGlobal(sel) : sel;
  if (ROOT_SELECTOR.test(local)) return local;
  if (isAlreadyScoped(local, prefix)) return local;
  return `${prefix} ${local}`;
}

/** True when the selector already begins with this component's class, with a
 * boundary so `.hero2` is not mistaken for `.hero`. */
function isAlreadyScoped(sel: string, prefix: string): boolean {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}(?![\\w-])`).test(sel);
}

// ── CSS splitting ───────────────────────────────────────

function splitBlocks(css: string): string[] {
  const blocks: string[] = [];
  let depth = 0;
  let start = 0;

  for (let i = 0; i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}') {
      depth--;
      if (depth === 0) {
        blocks.push(css.slice(start, i + 1));
        start = i + 1;
      }
    }
  }

  const remainder = css.slice(start).trim();
  if (remainder) blocks.push(remainder);

  return blocks;
}

// ── Normalization for dedup ─────────────────────────────

function normalizeRule(rule: string): string {
  return rule
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*\{\s*/g, '{')
    .replace(/\s*\}\s*/g, '}')
    .replace(/;\s*/g, ';')
    .replace(/,\s*/g, ',')
    .trim();
}
