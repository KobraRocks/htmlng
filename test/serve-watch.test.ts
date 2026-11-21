import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createProject, type FixtureProject } from './helpers/fixture.js';

/**
 * `watch` and `serve --watch` are long-running commands, so they cannot be
 * driven through `run()` like the other CLI tests. Spawn the real entry point
 * instead and observe its output streams.
 */
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const TSX_LOADER = join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'loader.mjs');
const CLI_ENTRY = join(REPO_ROOT, 'src', 'index.ts');

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface CliProcess {
  stdout(): string;
  stderr(): string;
  waitForStdout(pattern: RegExp, timeoutMs?: number): Promise<void>;
  waitForStderr(pattern: RegExp, timeoutMs?: number): Promise<void>;
  stop(): Promise<void>;
}

function waitFor(
  read: () => string,
  pattern: RegExp,
  label: string,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const timer = setInterval(() => {
      if (pattern.test(read())) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() > deadline) {
        clearInterval(timer);
        reject(new Error(`Timed out waiting for ${label}`));
      }
    }, 25);
  });
}

function startCli(cwd: string, args: string[]): CliProcess {
  const child: ChildProcess = spawn(
    process.execPath,
    ['--import', TSX_LOADER, CLI_ENTRY, ...args],
    { cwd, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  if (!child.stdout || !child.stderr) throw new Error('Expected piped stdout and stderr');

  let out = '';
  let err = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => { out += chunk; });
  child.stderr.on('data', (chunk: string) => { err += chunk; });

  return {
    stdout: () => out,
    stderr: () => err,
    waitForStdout: (pattern, timeoutMs = 10_000) => waitFor(() => out, pattern, 'stdout', timeoutMs),
    waitForStderr: (pattern, timeoutMs = 10_000) => waitFor(() => err, pattern, 'stderr', timeoutMs),
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill('SIGTERM');
      const didExit = await Promise.race([exited.then(() => true), delay(2_000).then(() => false)]);
      if (!didExit) {
        child.kill('SIGKILL');
        await Promise.race([exited, delay(1_000)]);
      }
    },
  };
}

describe('long-running commands report warnings', () => {
  let project: FixtureProject;
  let running: CliProcess[];

  beforeEach(() => {
    project = createProject({ prefix: 'htmlng-serve-watch-' });
    running = [];
  });

  afterEach(async () => {
    await Promise.all(running.map((cli) => cli.stop()));
    project.remove();
  });

  function start(args: string[]): CliProcess {
    const cli = startCli(project.dir, args);
    running.push(cli);
    return cli;
  }

  function projectWithOrphan(): string {
    project.component('sec');
    project.page('index', ['sec']);
    project.data('index', 'sec', 'heading: "H"\n');
    project.data('index', 'orphan', 'heading: "O"\n');
    return join(project.dir, 'data', 'index', 'orphan.yaml');
  }

  it("prints orphan warnings from watch's initial build", async () => {
    const orphan = projectWithOrphan();

    const cli = start(['watch']);

    await cli.waitForStderr(/WARNING \[.*orphan\.yaml\]: Data file/);
    expect(cli.stderr()).toContain(
      `Data file "${orphan}" has no matching component on page "index"`,
    );
  }, 15_000);

  it("adds no stderr output when watch's initial build has no warnings", async () => {
    project.component('sec');
    project.page('index', ['sec']);
    project.data('index', 'sec', 'heading: "H"\n');

    const cli = start(['watch']);

    await cli.waitForStdout(/Watching for changes/);
    await delay(150);
    expect(cli.stderr()).toBe('');
  }, 15_000);

  it('prints orphan warnings when serve --watch rebuilds', async () => {
    const orphan = projectWithOrphan();
    const pagePath = join(project.dir, 'pages', 'index.page.yaml');
    const originalPage = readFileSync(pagePath, 'utf8');

    const cli = start(['serve', '--watch', '--port', '0']);
    await cli.waitForStdout(/Hot reload enabled/);

    // Chokidar is ready just after "Hot reload enabled"; keep touching the page
    // until the watcher sees it rather than relying on a fixed startup delay.
    for (let i = 0; i < 30 && !/WARNING/.test(cli.stderr()); i++) {
      writeFileSync(pagePath, `${originalPage}\n# touch ${i}\n`);
      await delay(150);
    }

    expect(cli.stderr()).toContain(
      `Data file "${orphan}" has no matching component on page "index"`,
    );
    expect(cli.stdout()).toContain('[rebuilt]');
  }, 20_000);
});
