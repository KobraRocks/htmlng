import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ERROR_CATALOG, explainError, allErrorCodes } from '../src/error-catalog.js';

const SRC = join(import.meta.dirname, '..', 'src');

/**
 * Extract the string literals passed inside `new EngineError(...)` and
 * `emitJsonError(...)` calls. The error code is the only SCREAMING_SNAKE literal
 * in those calls; 'ERROR'/'WARNING' are levels, not codes. String literals are
 * skipped while balancing parentheses so a `)` inside a message cannot truncate
 * the scan, and both quote styles are matched.
 */
function codesInCalls(source: string): string[] {
  const codes: string[] = [];
  const callRe = /(?:new EngineError\(|emitJsonError\()/g;
  let m: RegExpExecArray | null;

  while ((m = callRe.exec(source)) !== null) {
    let i = m.index + m[0].length;
    let depth = 1;
    let quote = '';

    while (i < source.length && depth > 0) {
      const ch = source[i];
      if (quote) {
        if (ch === '\\') i++;
        else if (ch === quote) quote = '';
      } else if (ch === '"' || ch === "'" || ch === '`') {
        quote = ch;
      } else if (ch === '(') {
        depth++;
      } else if (ch === ')') {
        depth--;
        if (depth === 0) break;
      }
      i++;
    }

    const body = source.slice(m.index + m[0].length, i);
    for (const lit of body.matchAll(/['"]([A-Z][A-Z0-9_]{2,})['"]/g)) {
      if (lit[1] !== 'ERROR' && lit[1] !== 'WARNING') codes.push(lit[1]);
    }
  }
  return codes;
}

describe('error catalog coverage', () => {
  const files = readdirSync(SRC).filter((f) => f.endsWith('.ts'));

  it('catalogs every error code thrown or emitted in src/', () => {
    const missing = new Set<string>();
    for (const file of files) {
      for (const code of codesInCalls(readFileSync(join(SRC, file), 'utf-8'))) {
        if (!explainError(code)) missing.add(`${code} (${file})`);
      }
    }
    expect([...missing]).toEqual([]);
  });

  it('gives every catalog entry a summary and a fix', () => {
    for (const code of allErrorCodes()) {
      expect(ERROR_CATALOG[code].summary.length, `${code} summary`).toBeGreaterThan(0);
      expect(ERROR_CATALOG[code].fix.length, `${code} fix`).toBeGreaterThan(0);
    }
  });

  it('resolves the codes an author hits most', () => {
    for (const code of [
      'SCHEMA_VALIDATION',
      'SCHEMA_FIELD_UNUSED',
      'DATA_KEY_UNUSED',
      'DATA_FILE_ORPHAN',
      'PAGE_BODY_CHILD',
      'PAGE_LAYOUT_INVALID',
      'COMPONENT_PLACEHOLDER_IN_ATTRIBUTE',
    ]) {
      expect(explainError(code), code).not.toBeNull();
    }
  });

  it('returns null for an unknown code', () => {
    expect(explainError('NOT_A_REAL_CODE')).toBeNull();
  });
});
