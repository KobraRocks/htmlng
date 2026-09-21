#!/usr/bin/env node

const nodeVersion = process.version;
const major = parseInt(nodeVersion.slice(1).split('.')[0], 10);
if (major < 22) {
  process.stderr.write(`Engine requires Node.js ≥ 22 (current: ${nodeVersion})\n`);
  process.exit(1);
}

// Piping into `head`/`grep -m1` closes stdout early. Exit quietly on EPIPE
// rather than crashing with an unhandled stream error.
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') process.exit(0);
    throw err;
  });
}

// Dynamic import so the version guard above runs before the CLI module loads.
const { run } = await import('./cli.js');

// Set the exit code but let the event loop drain, so long-running commands
// (`serve`, `watch`) stay alive instead of being killed by process.exit().
process.exitCode = await run(process.argv.slice(2));
