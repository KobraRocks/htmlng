/**
 * Project paths the long-running watch loops observe.
 *
 * Shared by `commands-build.ts` (`watch`) and `commands-serve.ts`
 * (`serve --watch`) so a new watched input is added in one place.
 */
import { join } from 'node:path';
import type { EngineConfig } from './types.js';

/** Source directories and root-level inputs whose changes can affect output. */
export function watchedSources(rootDir: string, config: EngineConfig): string[] {
  return [
    join(rootDir, config.paths.components),
    join(rootDir, config.paths.pages),
    join(rootDir, config.paths.data),
    join(rootDir, 'global.css'),
    join(rootDir, 'design-tokens.yaml'),
  ];
}
