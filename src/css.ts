import type { Component } from './types.js';

const PASSTHROUGH_AT_RULES = new Set(['@keyframes', '@font-face']);

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

function prefixSelectors(selectorList: string, prefix: string): string {
  return selectorList
    .split(',')
    .map((s) => {
      const sel = s.trim();
      if (sel.startsWith(prefix)) return sel;
      return `${prefix} ${sel}`;
    })
    .join(', ');
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
