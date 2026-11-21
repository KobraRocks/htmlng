/**
 * Shared fixture for tests that run the CLI or the engine against a real
 * project tree: a temp directory with the standard layout, plus in-memory CLI
 * output capture. Tests use it instead of growing their own copy, so a new
 * test cannot start from a config the others do not use.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/** Stdout/stderr captured from a `run()` call. */
export interface Capture {
  io: { out(s: string): void; err(s: string): void };
  out: string[];
  err: string[];
}

/** Collect CLI output in memory; pass `capture().io` to `run()`. */
export function capture(): Capture {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (s) => out.push(s), err: (s) => err.push(s) }, out, err };
}

export const outText = (c: Capture): string => c.out.join('');
export const errText = (c: Capture): string => c.err.join('');

/** Parse a captured `--json` payload. */
export const jsonOut = <T = any>(c: Capture): T => JSON.parse(outText(c)) as T;

export interface ProjectPaths {
  components: string;
  pages: string;
  data: string;
}

export interface ProjectOptions {
  /** mkdtemp prefix, e.g. "htmlng-cli-". */
  prefix: string;
  paths?: Partial<ProjectPaths>;
  inlineCSS?: boolean;
  strict?: boolean;
  requireAltText?: boolean;
}

export type ProjectConfigOptions = Omit<ProjectOptions, 'prefix'>;

interface ComponentOptions {
  template?: string;
  css?: string;
  schema?: string;
}

export interface FixtureProject {
  /** Absolute path of the project root. */
  dir: string;
  /** Rewrite engine.config.yaml, merging `next` over the current options. */
  configure(next?: ProjectConfigOptions): void;
  /** Write <components>/<name>.component.html. */
  component(name: string, opts?: ComponentOptions): void;
  /** Write <pages>/<name>.page.yaml; `extra` is appended verbatim. */
  page(name: string, components: string[], extra?: string): void;
  /** Write <data>/<page>/<component>.yaml. */
  data(pageName: string, component: string, yaml: string): void;
  /** Remove the temp directory; change cwd away from it first. */
  remove(): void;
}

const DEFAULT_PATHS: ProjectPaths = {
  components: 'components',
  pages: 'pages',
  data: 'data',
};

interface ConfigState {
  paths: ProjectPaths;
  inlineCSS: boolean;
  strict: boolean;
  requireAltText: boolean;
}

/** Create a temp project with the standard layout and config. */
export function createProject(options: ProjectOptions): FixtureProject {
  const { prefix, ...initial } = options;
  let config: ConfigState = {
    inlineCSS: initial.inlineCSS ?? false,
    strict: initial.strict ?? false,
    requireAltText: initial.requireAltText ?? true,
    paths: { ...DEFAULT_PATHS, ...initial.paths },
  };
  const dir = mkdtempSync(join(tmpdir(), prefix));

  const ensureDirs = (): void => {
    for (const path of [config.paths.components, config.paths.pages, config.paths.data]) {
      mkdirSync(join(dir, path), { recursive: true });
    }
  };

  const writeConfig = (): void => {
    const { paths } = config;
    writeFileSync(
      join(dir, 'engine.config.yaml'),
      'project:\n  name: "T"\n  lang: "en"\n' +
        `paths:\n  components: "${paths.components}"\n  pages: "${paths.pages}"\n  data: "${paths.data}"\n  assets: "assets"\n  build: "build"\n` +
        `build:\n  inlineCSS: ${config.inlineCSS}\n` +
        `validation:\n  strict: ${config.strict}\n  requireAltText: ${config.requireAltText}\n`,
    );
  };

  const configure = (next: ProjectConfigOptions = {}): void => {
    config = {
      ...config,
      ...next,
      paths: { ...config.paths, ...next.paths },
    };
    ensureDirs();
    writeConfig();
  };

  ensureDirs();
  writeFileSync(join(dir, 'global.css'), 'body { margin: 0; }\n');
  writeFileSync(join(dir, 'design-tokens.yaml'), 'primary: "#0066cc"\n');
  writeConfig();

  return {
    dir,
    configure,
    component(name, opts = {}) {
      const template = opts.template ?? '<h2>{{text:heading}}</h2>';
      const schema = opts.schema ?? '{"heading":{"type":"text","required":true}}';
      writeFileSync(
        join(dir, config.paths.components, `${name}.component.html`),
        `${template}\n---\n${opts.css ?? ''}\n---\n${schema}\n`,
      );
    },
    page(name, components, extra = '') {
      const list = components.map((c) => `  - ${c}`).join('\n');
      writeFileSync(
        join(dir, config.paths.pages, `${name}.page.yaml`),
        `title: "${name}"\ndescription: "d"\ncomponents:\n${list}\n${extra}`,
      );
    },
    data(pageName, component, yaml) {
      const pageDir = join(dir, config.paths.data, pageName);
      mkdirSync(pageDir, { recursive: true });
      writeFileSync(join(pageDir, `${component}.yaml`), yaml);
    },
    remove() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
