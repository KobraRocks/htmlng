import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import type { EngineConfig } from './types.js';
import { EngineError } from './types.js';

const DEFAULTS: EngineConfig = {
  project: { name: '', lang: 'en' },
  paths: {
    components: 'components',
    pages: 'pages',
    data: 'data',
    assets: 'assets',
    build: 'build',
  },
  build: {
    minify: false,
    pretty: true,
    assetFingerprinting: false,
    inlineCSS: false,
  },
  validation: {
    strict: false,
    requireAltText: true,
    maxHeadingLength: 120,
  },
};

export function loadConfig(rootDir: string): EngineConfig {
  const configPath = join(rootDir, 'engine.config.yaml');
  let raw: Record<string, unknown>;

  try {
    const content = readFileSync(configPath, 'utf-8');
    raw = (load(content) as Record<string, unknown>) ?? {};
  } catch {
    throw new EngineError(
      `Failed to load or parse engine.config.yaml`,
      configPath,
    );
  }

  // Validate no path traversal in paths.* values
  for (const [key, value] of Object.entries(raw.paths ?? {})) {
    if (typeof value === 'string' && (value.includes('..') || value.includes('/'))) {
      throw new EngineError(
        `Invalid path value for paths.${key}: "${value}". Path traversal not allowed.`,
        configPath,
        `paths.${key}`,
      );
    }
  }

  const config = { ...DEFAULTS };

  if (raw.project && typeof raw.project === 'object') {
    const p = raw.project as Record<string, unknown>;
    if (typeof p.name === 'string') config.project.name = p.name;
    if (typeof p.lang === 'string') config.project.lang = p.lang;
  }

  if (raw.paths && typeof raw.paths === 'object') {
    const p = raw.paths as Record<string, unknown>;
    if (typeof p.components === 'string') config.paths.components = p.components;
    if (typeof p.pages === 'string') config.paths.pages = p.pages;
    if (typeof p.data === 'string') config.paths.data = p.data;
    if (typeof p.assets === 'string') config.paths.assets = p.assets;
    if (typeof p.build === 'string') config.paths.build = p.build;
  }

  if (raw.build && typeof raw.build === 'object') {
    const b = raw.build as Record<string, unknown>;
    if (typeof b.minify === 'boolean') config.build.minify = b.minify;
    if (typeof b.pretty === 'boolean') config.build.pretty = b.pretty;
    if (typeof b.assetFingerprinting === 'boolean') config.build.assetFingerprinting = b.assetFingerprinting;
    if (typeof b.inlineCSS === 'boolean') config.build.inlineCSS = b.inlineCSS;
  }

  if (raw.validation && typeof raw.validation === 'object') {
    const v = raw.validation as Record<string, unknown>;
    if (typeof v.strict === 'boolean') config.validation.strict = v.strict;
    if (typeof v.requireAltText === 'boolean') config.validation.requireAltText = v.requireAltText;
    if (typeof v.maxHeadingLength === 'number') config.validation.maxHeadingLength = v.maxHeadingLength;
  }

  return config;
}
