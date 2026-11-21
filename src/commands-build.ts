/**
 * Build-lifecycle commands: `build` writes output once; `watch` rebuilds the
 * affected pages when a source file changes and keeps the process alive.
 *
 * Wired into the `handlers` map in `cli.ts`; the build itself is delegated to
 * `build-pages.ts` so `serve --watch` shares the same code path.
 */
import { join, relative } from 'node:path';
import { EngineError } from './types.js';
import type { CliContext } from './cli-context.js';
import { pageTarget } from './cli-args.js';
import { loadConfig } from './config.js';
import { affectedPages } from './propagation.js';
import { buildPages } from './build-pages.js';
import { watchedSources } from './watch-sources.js';

export async function cmdBuild(ctx: CliContext, args: string[]): Promise<number> {
  ctx.log('Building...');
  const target = pageTarget(args);
  const { pages, warnings } = buildPages(ctx.root, target ? [target] : undefined);
  const buildDir = join(ctx.root, loadConfig(ctx.root).paths.build);
  const code = ctx.warningsExitCode(warnings);

  if (ctx.jsonMode) {
    ctx.emit({ ok: code === 0, pages, warnings: warnings.map((w) => w.toJSON()) });
  } else {
    ctx.io.out(`Built ${pages.length} page(s) to ${relative(ctx.root, buildDir)}/\n`);
    ctx.reportWarnings(warnings);
  }
  return code;
}

export async function cmdWatch(ctx: CliContext, _args: string[]): Promise<number> {
  ctx.log('Starting watch mode...');
  const { watch } = await import('chokidar');
  const config = loadConfig(ctx.root);

  const { warnings } = buildPages(ctx.root);
  ctx.reportWarnings(warnings);
  ctx.io.out('Watching for changes...\n');

  const watcher = watch(watchedSources(ctx.root, config), {
    ignored: ['**/node_modules/**', '**/.engine-cache.json'],
    // The initial build already covers files present at startup; chokidar's
    // initial `add` scan would emit every one of them and rebuild immediately.
    ignoreInitial: true,
    persistent: true,
  });

  let timeout: ReturnType<typeof setTimeout> | null = null;

  watcher.on('change', (fp: string) => schedule(fp));
  watcher.on('add', (fp: string) => schedule(fp));

  function schedule(filePath: string) {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => rebuild(filePath), 100);
  }

  function rebuild(filePath: string) {
    const rel = relative(ctx.root, filePath);
    const pages = affectedPages(ctx.root, rel);
    if (pages.length === 0) return;

    try {
      const { warnings } = buildPages(ctx.root, pages);
      ctx.io.out(`=== REBUILT: ${pages.join(', ')} (changed: ${rel})\n`);
      ctx.reportWarnings(warnings);
    } catch (e) {
      if (e instanceof EngineError) ctx.io.err(e.format() + '\n');
      else throw e;
    }
  }

  process.on('SIGINT', () => { watcher.close(); process.exit(0); });
  await new Promise(() => {});
  return 0;
}
