#!/usr/bin/env node

const nodeVersion = process.version;
const major = parseInt(nodeVersion.slice(1).split('.')[0], 10);
if (major < 22) {
  process.stderr.write(`Engine requires Node.js ≥ 22 (current: ${nodeVersion})\n`);
  process.exit(1);
}

import { run } from './cli.js';

run(process.argv.slice(2));
