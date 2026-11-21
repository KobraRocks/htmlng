import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const SRC = join(ROOT, 'src');
const BASELINE_PATH = join(ROOT, 'test', 'architecture-baseline.json');

/** A source module reduced to the facts the architecture checks need. */
interface SourceFile {
  /** Repository-relative POSIX path, as used by the baseline. */
  path: string;
  content: string;
  /** Physical lines, matching `wc -l`. */
  lines: number;
}

/** Collect every `.ts` module under `src/`, recursively. */
function sourcePaths(dir: string = SRC): string[] {
  const paths: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.ts')) paths.push(path);
    }
  };
  walk(dir);
  return paths.sort();
}

/** Repository-relative POSIX path for an absolute path. */
function repoPath(absPath: string): string {
  return relative(ROOT, absPath).split(/[\\/]/).join('/');
}

/** Read `src/` once and expose path, content, and physical line count. */
function readSourceFiles(): SourceFile[] {
  return sourcePaths().map((absPath) => {
    const content = readFileSync(absPath, 'utf-8');
    return { path: repoPath(absPath), content, lines: countLines(content) };
  });
}

/** Physical line count: newline count, plus a non-terminated final line. */
function countLines(content: string): number {
  if (content === '') return 0;
  const newlines = (content.match(/\n/g) ?? []).length;
  return content.endsWith('\n') ? newlines : newlines + 1;
}

/**
 * A module docblock is the first content in the file, after an optional
 * shebang line.
 */
function hasModuleDocblock(content: string): boolean {
  const withoutShebang = content.replace(/^#![^\n]*\n?/, '');
  return withoutShebang.trimStart().startsWith('/**');
}

/** Files whose first content is not a leading block comment. */
function docblockViolations(files: SourceFile[]): string[] {
  return files
    .filter((file) => !hasModuleDocblock(file.content))
    .map((file) => `${file.path}: missing a leading module docblock`);
}

/**
 * Parent traversals in a relative specifier: `./x` is 0, `../x` is 1,
 * `../../x` is 2, and `./../../x` is also 2.
 */
function relativeDepth(specifier: string): number {
  const normalized = specifier.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
  const ups = normalized.match(/^(?:\.\.\/)+/);
  return ups ? ups[0].length / '../'.length : 0;
}

const STATIC_SPECIFIER =
  /(?:^|\n)[ \t]*(?:import|export)\b[^;]*?\bfrom\s*['"]([^'"]+)['"]/g;
const BARE_SPECIFIER = /(?:^|\n)[ \t]*import\s*['"]([^'"]+)['"]/g;
const DYNAMIC_SPECIFIER = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

/** Every relative or package specifier in import, export, and dynamic form. */
function importSpecifiers(content: string): string[] {
  return [STATIC_SPECIFIER, BARE_SPECIFIER, DYNAMIC_SPECIFIER].flatMap((pattern) =>
    [...content.matchAll(pattern)].map((match) => match[1]),
  );
}

/** Imports that traverse two or more parent directories (`../../` and beyond). */
function importDepthViolations(files: SourceFile[]): string[] {
  return files.flatMap((file) =>
    importSpecifiers(file.content)
      .filter((specifier) => relativeDepth(specifier) >= 2)
      .map((specifier) => `${file.path}: '${specifier}' traverses two or more parent directories`),
  );
}

/** Parse the ratchet baseline: a flat object of `src/...ts` paths to line counts. */
function parseBaseline(raw: string): Record<string, number> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('test/architecture-baseline.json is not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      'test/architecture-baseline.json must be one object mapping repository-relative source paths to line counts',
    );
  }
  const baseline: Record<string, number> = {};
  for (const [path, value] of Object.entries(parsed)) {
    if (!/^src\/.*\.ts$/.test(path)) {
      throw new Error(`baseline entry '${path}' must be a path under src/ ending in .ts`);
    }
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
      throw new Error(`baseline entry '${path}' must be a positive integer line count`);
    }
    baseline[path] = value;
  }
  return baseline;
}

/**
 * Baselined files must match their recorded count exactly. A shrink is a
 * failure too: it asks the author to lower the baseline in the same change,
 * so the ratchet only turns one way.
 */
function baselineViolations(
  baseline: Record<string, number>,
  files: SourceFile[],
): string[] {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const violations: string[] = [];
  for (const [path, expected] of Object.entries(baseline)) {
    const file = byPath.get(path);
    if (!file) {
      violations.push(`${path}: baselined file is missing; remove the entry or restore the file`);
      continue;
    }
    if (file.lines === expected) continue;
    if (file.lines > expected) {
      violations.push(
        `${path}: grew from ${expected} to ${file.lines} lines; extract code instead of raising the baseline (see docs/adr/0001-architecture-guardrails.md)`,
      );
    } else {
      violations.push(
        `${path}: shrank from ${expected} to ${file.lines} lines; lower the baseline to ${file.lines}`,
      );
    }
  }
  return violations;
}

describe('architecture: physical line counting', () => {
  it('counts the way wc -l does, with no phantom line for a trailing newline', () => {
    expect(countLines('')).toBe(0);
    expect(countLines('a')).toBe(1);
    expect(countLines('a\n')).toBe(1);
    expect(countLines('a\nb')).toBe(2);
    expect(countLines('a\nb\n')).toBe(2);
  });
});

describe('architecture: module docblocks', () => {
  it('accepts a block comment as the first content, with or without a shebang', () => {
    expect(hasModuleDocblock('/**\n * Module.\n */\nimport x from "./x.js";')).toBe(true);
    expect(hasModuleDocblock('#!/usr/bin/env node\n\n/**\n * Module.\n */\nconst x = 1;')).toBe(true);
  });

  it('rejects files that start with code, a line comment, or nothing', () => {
    expect(hasModuleDocblock('import x from "./x.js";')).toBe(false);
    expect(hasModuleDocblock('// banner\nimport x from "./x.js";')).toBe(false);
    expect(hasModuleDocblock('const x = 1;')).toBe(false);
  });

  it('every source file starts with a module docblock', () => {
    expect(docblockViolations(readSourceFiles()), 'Add a leading /** module docblock').toEqual(
      [],
    );
  });
});

describe('architecture: import depth', () => {
  it('measures parent traversals, normalizing a leading ./', () => {
    expect(relativeDepth('./x.js')).toBe(0);
    expect(relativeDepth('../x.js')).toBe(1);
    expect(relativeDepth('../../x.js')).toBe(2);
    expect(relativeDepth('../../../x.js')).toBe(3);
    expect(relativeDepth('./../../x.js')).toBe(2);
    expect(relativeDepth('node:fs')).toBe(0);
    expect(relativeDepth('chokidar')).toBe(0);
  });

  it('finds static, type, re-export, bare, and dynamic specifiers', () => {
    expect(importSpecifiers('import x from "./x.js";')).toEqual(['./x.js']);
    expect(importSpecifiers('import type { X } from "../types.js";')).toEqual(['../types.js']);
    expect(importSpecifiers('export * from "./x.js";')).toEqual(['./x.js']);
    expect(importSpecifiers('import "./x.js";')).toEqual(['./x.js']);
    expect(importSpecifiers('const m = await import("../../x.js");')).toEqual(['../../x.js']);
    expect(importSpecifiers('import {\n  x\n} from "../../x.js";')).toEqual(['../../x.js']);
  });

  it('rejects two-parent imports in every import form', () => {
    const files: SourceFile[] = [
      { path: 'src/a.ts', content: 'import x from "../../x.js";', lines: 1 },
      { path: 'src/b.ts', content: 'import type { X } from "../../x.js";', lines: 1 },
      { path: 'src/c.ts', content: 'export * from "../../x.js";', lines: 1 },
      { path: 'src/d.ts', content: 'import "../../x.js";', lines: 1 },
      { path: 'src/e.ts', content: 'const m = await import("../../x.js");', lines: 1 },
      { path: 'src/f.ts', content: 'import x from "./../../x.js";', lines: 1 },
    ];
    expect(importDepthViolations(files)).toHaveLength(6);
  });

  it('allows one parent, same-directory, and package imports', () => {
    const files: SourceFile[] = [
      { path: 'src/a.ts', content: 'import x from "../x.js";', lines: 1 },
      { path: 'src/b.ts', content: 'import x from "./x.js";', lines: 1 },
      { path: 'src/c.ts', content: 'import x from "node:fs";', lines: 1 },
    ];
    expect(importDepthViolations(files)).toEqual([]);
  });

  it('ignores static import-like text in comments and strings', () => {
    const content =
      '// import x from "../../x.js"\n' +
      '/* export * from "../../y.js" */\n' +
      'const s = "from \'../../z.js\'";';
    expect(importSpecifiers(content)).toEqual([]);
  });

  it('no source file traverses two parent directories', () => {
    expect(importDepthViolations(readSourceFiles())).toEqual([]);
  });
});

describe('architecture: file-size ratchet', () => {
  it('parses a flat path-to-count object', () => {
    expect(parseBaseline('{ "src/cli.ts": 1034 }')).toEqual({ 'src/cli.ts': 1034 });
    expect(parseBaseline('{}')).toEqual({});
  });

  it('rejects malformed baselines instead of silently passing', () => {
    expect(() => parseBaseline('[]')).toThrow(/must be one object/);
    expect(() => parseBaseline('{ "lib/cli.ts": 1 }')).toThrow(/under src\//);
    expect(() => parseBaseline('{ "src/cli.ts": "1034" }')).toThrow(/positive integer/);
    expect(() => parseBaseline('{ "src/cli.ts": 1.5 }')).toThrow(/positive integer/);
    expect(() => parseBaseline('not json')).toThrow(/not valid JSON/);
  });

  it('requires an exact match, so growth and shrink both fail', () => {
    const files: SourceFile[] = [
      { path: 'src/cli.ts', content: '', lines: 1034 },
      { path: 'src/new.ts', content: '', lines: 5000 },
    ];
    expect(baselineViolations({ 'src/cli.ts': 1034 }, files)).toEqual([]);
    expect(baselineViolations({ 'src/cli.ts': 1000 }, files)[0]).toMatch(/grew from 1000/);
    expect(baselineViolations({ 'src/cli.ts': 1100 }, files)[0]).toMatch(/lower the baseline/);
  });

  it('fails for a baselined file that was deleted or renamed', () => {
    const violations = baselineViolations({ 'src/cli.ts': 1034 }, []);
    expect(violations[0]).toMatch(/baselined file is missing/);
  });

  it('leaves files that are not in the baseline unchecked', () => {
    const files: SourceFile[] = [
      { path: 'src/cli.ts', content: '', lines: 1034 },
      { path: 'src/new.ts', content: '', lines: 5000 },
    ];
    expect(baselineViolations({ 'src/cli.ts': 1034 }, files)).toEqual([]);
  });

  it('every baselined file is at its recorded line count', () => {
    const baseline = parseBaseline(readFileSync(BASELINE_PATH, 'utf-8'));
    expect(baselineViolations(baseline, readSourceFiles())).toEqual([]);
  });
});
