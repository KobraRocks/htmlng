// ── HTML Engine — All type definitions ──────────────────

export interface EngineConfig {
  project: { name: string; lang: string };
  paths: { components: string; pages: string; data: string; assets: string; build: string };
  build: { minify: boolean; pretty: boolean; assetFingerprinting: boolean };
  validation: { strict: boolean; requireAltText: boolean; maxHeadingLength: number };
}

export interface PlaceholderSchema {
  [placeholderName: string]: {
    type: 'text' | 'html' | 'image' | 'link' | 'list' | 'bool' | 'slot';
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

export interface Page {
  title: string;
  description: string;
  lang?: string;
  favicon?: string;
  viewport?: string;
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

export class EngineError extends Error {
  constructor(
    message: string,
    public file: string,
    public field?: string,
    public level: 'ERROR' | 'WARNING' = 'ERROR',
    public help?: string,
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
}
