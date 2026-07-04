import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './config.js';

export function copyAssets(rootDir: string): void {
  const config = loadConfig(rootDir);
  const src = join(rootDir, config.paths.assets);
  const dest = join(rootDir, config.paths.build, 'assets');

  if (!existsSync(src)) return;

  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
}
