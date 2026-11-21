/**
 * `serve`: static file server for `build/`, with optional watch, server-sent
 * hot reload, and path-traversal confinement.
 *
 * Wired into the `handlers` map in `cli.ts`; rebuilds use `build-pages.ts` so
 * `serve --watch` and `watch` produce identical output.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep, extname } from 'node:path';
import { EngineError } from './types.js';
import type { CliContext } from './cli-context.js';
import { loadConfig } from './config.js';
import { buildPages } from './build-pages.js';
import { watchedSources } from './watch-sources.js';

export async function cmdServe(ctx: CliContext, _args: string[]): Promise<number> {
  const config = loadConfig(ctx.root);
  const buildDir = join(ctx.root, config.paths.build);
  const port = parseInt(ctx.flag('--port') ?? '3000', 10);
  const watching = ctx.has('--watch');

  const { createServer } = await import('node:http');

  const MIME: Record<string, string> = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.txt': 'text/plain',
  };

  // SSE clients for hot reload
  const clients: Array<{ write: (data: string) => void }> = [];

  const RELOAD_SCRIPT = `\n<script>\nnew EventSource('/__htmlng_reload').onmessage = () => location.reload();\n</script>`;

  const server = createServer((req, res) => {
    const rawUrl = (req.url ?? '/').split('?')[0];
    const url = rawUrl === '/' ? '/index.html' : rawUrl;

    // SSE endpoint for hot reload
    if (watching && url === '/__htmlng_reload') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.write('data: connected\n\n');
      const client = { write: (data: string) => res.write(data) };
      clients.push(client);
      req.on('close', () => {
        const idx = clients.indexOf(client);
        if (idx !== -1) clients.splice(idx, 1);
      });
      return;
    }

    // Confine every request to buildDir — reject path traversal
    const resolved = resolve(buildDir, `.${url}`);
    if (resolved !== buildDir && !resolved.startsWith(buildDir + sep)) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    if (!existsSync(resolved)) { res.writeHead(404); res.end('Not found'); return; }

    let content = readFileSync(resolved, 'utf-8');
    const ext = extname(resolved);

    // Inject reload script into HTML if watching
    if (watching && ext === '.html') {
      content = content.replace('</body>', RELOAD_SCRIPT + '</body>');
    }

    res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
    res.end(content);
  });

  server.listen(port, () => {
    ctx.io.out(`Serving ${relative(ctx.root, buildDir)}/ at http://localhost:${port}\n`);
    if (watching) ctx.io.out(`Hot reload enabled — watching for changes\n`);
  });

  if (watching) {
    const { watch } = await import('chokidar');
    const watcher = watch(watchedSources(ctx.root, config), { ignored: ['**/node_modules/**'] });

    let timeout: ReturnType<typeof setTimeout> | null = null;
    watcher.on('change', () => {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        try {
          const { warnings } = buildPages(ctx.root);
          ctx.io.out('[rebuilt]\n');
          ctx.reportWarnings(warnings);
          for (const client of clients) client.write('data: reload\n\n');
          clients.length = 0;
        } catch (e) {
          if (e instanceof EngineError) ctx.io.err(e.format() + '\n');
          else throw e;
        }
      }, 100);
    });
  }

  return 0;
}
