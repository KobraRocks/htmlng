// ── HTML Engine — All type definitions ──────────────────

import type { ErrorCode } from './error-catalog.js';

export interface EngineConfig {
  project: { name: string; lang: string };
  paths: { components: string; pages: string; data: string; assets: string; build: string };
  build: { inlineCSS: boolean };
  validation: { strict: boolean; requireAltText: boolean };
}

/**
 * Placeholder types a component schema may declare, in documentation order.
 * Single source of truth: `PlaceholderType` is derived from it, and the parser
 * plus `htmlng schema` both consume it. Template-only guards (`if`/`unless`)
 * are deliberately absent.
 */
export const PLACEHOLDER_TYPES = ['text', 'html', 'image', 'link', 'list', 'bool', 'slot'] as const;

export type PlaceholderType = (typeof PLACEHOLDER_TYPES)[number];

export interface PlaceholderSchema {
  [placeholderName: string]: {
    type: PlaceholderType;
    required?: boolean;
    maxLength?: number;
  };
}

export interface Component {
  name: string;
  template: string;
  css: string;
  schema: PlaceholderSchema;
}

/** Page-level layout hooks (issue 09/10): optional wrapper element and body classes. */
export interface PageLayout {
  /** Wrap all component wrappers in `<div id="page" class="page">`. */
  wrapper?: boolean;
  /** Extra classes appended to `<body class="...">` after the page name. */
  bodyClass?: string;
}

export interface Page {
  title: string;
  description: string;
  lang?: string;
  favicon?: string;
  viewport?: string;
  layout?: PageLayout;
  head?: {
    meta?: Array<{ name: string; content: string }>;
    link?: Array<{ rel: string; href: string }>;
  };
  scripts?: Array<{
    src: string;
    defer?: boolean;
    async?: boolean;
    type?: string;
    head?: boolean;
  }>;
  components: string[];
}

export interface ImageValue {
  src: string;
  alt?: string;
  width?: number;
  height?: number;
  loading?: 'lazy' | 'eager';
  class?: string;
}

export interface LinkValue {
  href: string;
  label: string;
  class?: string;
}

export interface SlotValue {
  component: string;
  data?: Record<string, PlaceholderValue>;
}

export type PlaceholderValue =
  | string
  | boolean
  | ImageValue
  | LinkValue
  | SlotValue
  | PlaceholderValue[];

export interface CacheManifest {
  version: number;
  pages: Record<string, {
    hash: string;
    builtAt: string;
    sources: Record<string, string>;
  }>;
}

// ── Error handling ──────────────────────────────────────

export type ErrorLevel = 'ERROR' | 'WARNING';

/** Stable machine-readable shape used by `--json` output. */
export interface ErrorJson {
  code: ErrorCode;
  level: ErrorLevel;
  file: string;
  field?: string;
  message: string;
  help?: string;
}

export class EngineError extends Error {
  constructor(
    message: string,
    public file = '',
    public field?: string,
    public level: ErrorLevel = 'ERROR',
    public help?: string,
    public code: ErrorCode = 'E_UNKNOWN',
  ) {
    super(message);
    this.name = 'EngineError';
  }

  format(): string {
    const loc = this.field ? `${this.file}:${this.field}` : this.file;
    let out = `${this.level} [${loc}]: ${this.message}`;
    if (this.help) out += `\n  ${this.help}`;
    return out;
  }

  toJSON(): ErrorJson {
    return {
      code: this.code,
      level: this.level,
      file: this.file,
      field: this.field,
      message: this.message,
      help: this.help,
    };
  }
}
