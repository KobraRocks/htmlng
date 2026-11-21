import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EngineError } from '../src/types.js';
import { loadConfig } from '../src/config.js';
import {
  collectDiagnostic,
  dedupeDiagnostics,
  orphanDataWarnings,
} from '../src/diagnostics.js';
import { createProject, type FixtureProject } from './helpers/fixture.js';

/** Build a diagnostic whose identity is explicit at the call site. */
function diagnostic(
  message: string,
  opts: { file?: string; field?: string; code?: 'PAGE_DUPLICATE_ID' | 'SCHEMA_VALIDATION' } = {},
): EngineError {
  return new EngineError(
    message,
    opts.file ?? '',
    opts.field,
    'ERROR',
    undefined,
    opts.code ?? 'PAGE_DUPLICATE_ID',
  );
}

describe('dedupeDiagnostics', () => {
  it('reports an identical diagnostic once, keeping the first occurrence', () => {
    const first = diagnostic('Page has a duplicate id', { file: 'pages/a.page.yaml' });
    const second = diagnostic('Page has a duplicate id', { file: 'pages/a.page.yaml' });

    const result = dedupeDiagnostics([first, second]);

    expect(result).toHaveLength(1);
    expect(result[0]).toBe(first);
  });

  it('keeps diagnostics that differ by file, field, or code', () => {
    const items = [
      diagnostic('same', { file: 'pages/a.page.yaml' }),
      diagnostic('same', { file: 'pages/b.page.yaml' }),
      diagnostic('same', { file: 'pages/a.page.yaml', field: 'components' }),
      diagnostic('same', { file: 'pages/a.page.yaml', code: 'SCHEMA_VALIDATION' }),
    ];

    expect(dedupeDiagnostics(items)).toHaveLength(4);
  });

  it('preserves first-occurrence order', () => {
    const a = diagnostic('a');
    const b = diagnostic('b');

    expect(dedupeDiagnostics([a, b, diagnostic('a')])).toEqual([a, b]);
  });
});

describe('collectDiagnostic', () => {
  it('collects a thrown diagnostic instead of aborting, attributed to the page', () => {
    const errors: EngineError[] = [];

    collectDiagnostic(
      errors,
      () => {
        throw new EngineError(
          'Page has a duplicate id',
          '',
          'components',
          'ERROR',
          'Give each component a unique id.',
          'PAGE_DUPLICATE_ID',
        );
      },
      'pages/b.page.yaml',
    );

    expect(errors).toHaveLength(1);
    expect(errors[0].toJSON()).toEqual({
      code: 'PAGE_DUPLICATE_ID',
      level: 'ERROR',
      file: 'pages/b.page.yaml',
      field: 'components',
      message: 'Page has a duplicate id',
      help: 'Give each component a unique id.',
    });
  });

  it('keeps the file a thrown diagnostic already names', () => {
    const errors: EngineError[] = [];

    collectDiagnostic(
      errors,
      () => { throw new EngineError('bad data', 'data/b/sec.yaml', 'heading', 'ERROR', undefined, 'SCHEMA_VALIDATION'); },
      'pages/b.page.yaml',
    );

    expect(errors[0].file).toBe('data/b/sec.yaml');
  });

  it('rethrows anything that is not an EngineError', () => {
    expect(() => collectDiagnostic([], () => { throw new Error('unexpected bug'); }))
      .toThrow('unexpected bug');
  });
});

describe('orphanDataWarnings', () => {
  let dir: string;
  let project: FixtureProject;

  beforeEach(() => {
    project = createProject({ prefix: 'htmlng-diagnostics-' });
    dir = project.dir;
  });

  afterEach(() => {
    project.remove();
  });

  it('warns once per orphaned data file with its path and fix', () => {
    project.component('sec');
    project.page('index', ['sec']);
    project.data('index', 'used', 'heading: "x"\n');
    project.data('index', 'stale-b', 'heading: "y"\n');
    project.data('index', 'stale-a', 'heading: "z"\n');
    writeFileSync(join(dir, 'data', 'index', 'notes.txt'), 'ignored\n');

    const warnings = orphanDataWarnings(dir, loadConfig(dir), 'index', ['used']);

    const staleA = join(dir, 'data', 'index', 'stale-a.yaml');
    const staleB = join(dir, 'data', 'index', 'stale-b.yaml');
    expect(warnings.map((w) => w.toJSON())).toEqual([
      {
        code: 'DATA_FILE_ORPHAN',
        level: 'WARNING',
        file: staleA,
        field: undefined,
        message: `Data file "${staleA}" has no matching component on page "index"`,
        help: 'Delete the file, or add "stale-a" back to the page\'s components.',
      },
      {
        code: 'DATA_FILE_ORPHAN',
        level: 'WARNING',
        file: staleB,
        field: undefined,
        message: `Data file "${staleB}" has no matching component on page "index"`,
        help: 'Delete the file, or add "stale-b" back to the page\'s components.',
      },
    ]);
  });

  it('reports nothing when every data file matches a page component', () => {
    project.component('sec');
    project.page('index', ['sec']);
    project.data('index', 'sec', 'heading: "x"\n');

    expect(orphanDataWarnings(dir, loadConfig(dir), 'index', ['sec'])).toEqual([]);
  });

  it('reports nothing when the page has no data directory', () => {
    expect(orphanDataWarnings(dir, loadConfig(dir), 'missing', ['sec'])).toEqual([]);
  });
});
