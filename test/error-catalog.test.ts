import { describe, it, expect } from 'vitest';
import { ERROR_CATALOG, explainError, allErrorCodes } from '../src/error-catalog.js';

// Codes thrown or emitted in src/ are checked against this registry by the
// compiler: `EngineError.code` and `emitJsonError` accept only `ErrorCode`.
describe('error catalog', () => {
  it('gives every registered code a summary and a fix', () => {
    for (const code of allErrorCodes()) {
      expect(ERROR_CATALOG[code].summary.length, `${code} summary`).toBeGreaterThan(0);
      expect(ERROR_CATALOG[code].fix.length, `${code} fix`).toBeGreaterThan(0);
    }
  });

  it('resolves every registered code to its entry', () => {
    for (const code of allErrorCodes()) {
      expect(explainError(code), code).toBe(ERROR_CATALOG[code]);
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
    ] as const) {
      expect(explainError(code), code).not.toBeNull();
    }
  });

  it('returns null for an unknown code', () => {
    expect(explainError('NOT_A_REAL_CODE')).toBeNull();
  });
});
