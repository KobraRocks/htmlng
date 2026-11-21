import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { COMMAND_NAMES, HELP } from '../src/cli.js';

const ROOT = join(import.meta.dirname, '..');

/** Markdown a reader must be able to follow anywhere, not just on the author's machine. */
const DOC_FILES = [
  'README.md',
  ...readdirSync(join(ROOT, 'skill'))
    .filter((f) => f.endsWith('.md'))
    .map((f) => `skill/${f}`),
  'AGENTS.md'
];

/** A home directory path (`/home/<user>/…` or `~/…`) never resolves for another reader. */
const MACHINE_PATH = /\/home\/[A-Za-z0-9._-]+\/|(?:^|\s)~\/[A-Za-z0-9._-]+\//;

function machinePathHits(relPath: string): string[] {
  const lines = readFileSync(join(ROOT, relPath), 'utf-8').split('\n');
  return lines.flatMap((line, i) => (MACHINE_PATH.test(line) ? [`${relPath}:${i + 1}: ${line.trim()}`] : []));
}

/** Command tokens from README's command table: `| `htmlng <cmd> ...` |` */
function readmeTableCommands(): string[] {
  const text = readFileSync(join(ROOT, 'README.md'), 'utf-8');
  const found = new Set<string>();
  for (const line of text.split('\n')) {
    const m = line.match(/^\|\s*`htmlng ([a-z]+)/);
    if (m) found.add(m[1]);
  }
  return [...found];
}

/** `htmlng <cmd>` tokens appearing inside fenced code blocks of a doc. */
function fencedCommands(relPath: string): string[] {
  const text = readFileSync(join(ROOT, relPath), 'utf-8');
  const found = new Set<string>();
  for (const block of text.matchAll(/```[a-z]*\n([\s\S]*?)```/g)) {
    // Drop trailing `# comments` so prose like "the htmlng binary" is ignored
    const body = block[1].split('\n').map((l) => l.replace(/\s#.*$/, '')).join('\n');
    for (const m of body.matchAll(/htmlng ([a-z]+)/g)) found.add(m[1]);
  }
  return [...found];
}

describe('docs conformance', () => {
  it('has a canonical command list', () => {
    expect(COMMAND_NAMES.length).toBeGreaterThan(10);
    expect(new Set(COMMAND_NAMES).size).toBe(COMMAND_NAMES.length);
  });

  it('README command table matches the CLI exactly', () => {
    const documented = new Set(readmeTableCommands());
    const actual = new Set(COMMAND_NAMES);
    const phantom = [...documented].filter((c) => !actual.has(c));
    const undocumented = [...actual].filter((c) => !documented.has(c));
    expect(phantom, `README documents non-existent commands: ${phantom.join(', ')}`).toEqual([]);
    expect(undocumented, `README is missing commands: ${undocumented.join(', ')}`).toEqual([]);
  });

  it('HELP mentions every command', () => {
    const missing = COMMAND_NAMES.filter((c) => !HELP.includes(`${c} `));
    expect(missing, `HELP is missing: ${missing.join(', ')}`).toEqual([]);
  });

  it('SKILL.md code blocks only reference real commands', () => {
    const unknown = fencedCommands('skill/SKILL.md').filter((c) => !COMMAND_NAMES.includes(c));
    expect(unknown, `SKILL.md references unknown commands: ${unknown.join(', ')}`).toEqual([]);
  });

  it('AGENTS.md golden path only references real commands', () => {
    const unknown = fencedCommands('AGENTS.md').filter((c) => !COMMAND_NAMES.includes(c));
    expect(unknown, `AGENTS.md references unknown commands: ${unknown.join(', ')}`).toEqual([]);
  });

  it('docs contain no machine-specific absolute paths', () => {
    const hits = DOC_FILES.flatMap(machinePathHits);
    expect(hits, `paths that only resolve on one machine:\n${hits.join('\n')}`).toEqual([]);
  });
});
