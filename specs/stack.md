# HTML Engine — Technology Stack & Implementation Guide

> **Status**: draft  
> **Created**: 2026-07-04  
> **Updated**: 2026-07-04 (AI-implementer-focused rewrite)  
> **References**: [[html-engine]] §11 Open Questions  
> **Audience**: AI coding agent implementing the engine

---

## 1. Recommendation: TypeScript on Node.js — stripped for AI implementation

**Language**: TypeScript (strict mode)  
**Runtime**: Node.js ≥ 22  
**Runner**: `tsx` (dev), `tsc` (production build)  
**Package manager**: npm (no pnpm — fewer setup steps for AI)

### Why this stack for an AI implementer

The engine is IO-bound (reading templates, writing HTML), not CPU-bound. Node's event loop is a natural fit. TypeScript catches type errors at build time — critical when an AI generates ~500 lines of code across 10+ files and needs rapid feedback that things connect correctly.

Every dependency below was chosen by asking: *"Will the AI understand this API from its training data, or will it need to read docs and experiment?"* Libraries with standard, predictable APIs beat powerful-but-quirky ones.

---

## 2. Dependencies — minimal set

### 2.1 Production dependencies (5 total)

```
npm install js-yaml ajv node-html-parser chokidar diff
```

| Package | Version | Purpose | Why this, not that |
|---------|---------|---------|-------------------|
| `js-yaml` | ^4 | Parse `.yaml` data files and page configs | Standard, predictable `load()` / `dump()` |
| `ajv` | ^8 | Validate data against component JSON schemas | `ajv.compile(schema)` → `validate(data)` — two lines |
| `node-html-parser` | ^6 | Parse component templates, assemble pages | Standard DOM API: `querySelector()`, `innerHTML`, `textContent`, `setAttribute()`. More predictable than cheerio's jQuery-flavored API. |
| `chokidar` | ^4 | File watching for `engine watch` | `chokidar.watch(dir, { ignored: ... }).on('change', fn)` — one pattern |
| `diff` | ^7 | Unified diffs for `engine diff` | `diff.createTwoFilesPatch(old, new, oldFile, newFile)` — one function |

**No CSS parsing library.** The scoping algorithm (§6.2) is simple string manipulation:

```
Split CSS rules on }
For each rule:
  Split selectors on ,
  For each selector:
    If not already prefixed with .className, prepend ".className "
  Rejoin selectors with ,
Rejoin rules with }
```

This is ~30 lines of regex. PostCSS + postcss-selector-parser adds 2 dependencies, ~800KB, and requires the AI to learn a plugin API and AST walker. For the problem at hand (prepend a class prefix to selectors), raw string manipulation is simpler, faster to implement, and has fewer edge cases than the AI might hit learning PostCSS internals.

**No templating library.** The `{{type:name}}` syntax is a custom recursive descent parser (~100 lines). Handlebars/Mustache would fight the typed placeholder model. See §4.2.

### 2.2 Dev dependencies (5 total)

```
npm install -D typescript @types/node @types/js-yaml tsx vitest
```

| Package | Purpose |
|---------|---------|
| `typescript` | Compiler |
| `@types/node` | Node stdlib types |
| `@types/js-yaml` | YAML types |
| `tsx` | Run TypeScript directly during development (`tsx src/index.ts render page index`) |
| `vitest` | Test runner + assertion library (fast, TypeScript-native, Jest-compatible API) |

> **Note on types**: `diff` v7+ and `node-html-parser` v6+ ship their own TypeScript declarations — no `@types/` packages needed for them. `js-yaml` requires `@types/js-yaml`.

### 2.3 vitest.config.ts

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
});
```

### 2.4 package.json scripts

```json
{
  "name": "html-engine",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "engine": "./dist/index.js"
  },
  "scripts": {
    "dev": "tsx src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  }
}
```

`"type": "module"` means ESM imports (`import { parse } from 'js-yaml'`). All code uses ESM. No CommonJS mixing — the AI writes `import`/`export` everywhere.

### 2.5 tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "resolveJsonModule": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "test"]
}
```

---

## 3. Project structure — flat and discoverable

```
html-engine/
  src/
    index.ts              # Entry point: parse argv, route to handler
    cli.ts                # Handler map + dispatch logic
    component.ts          # Parse component files (3-section --- split)
    template.ts           # Custom template engine ({{placeholders}})
    css.ts                # CSS scoping, assembly, dedup
    renderer.ts           # Page assembler (header/section/footer)
    validator.ts          # All build-time validation checks
    text-validator.ts     # Text field tag whitelist
    schema.ts             # ajv wrapper
    config.ts             # engine.config.yaml parser
    page.ts               # Page YAML parser
    data-file.ts          # Data file parser + lookup
    hasher.ts             # SHA-256 hashing + .engine-cache.json
    propagation.ts        # Which pages to rebuild on change
    copier.ts             # Asset copy to build/
    scaffold.ts           # engine create templates
    types.ts              # ALL TypeScript types in one file
  test/
    component.test.ts
    template.test.ts
    css.test.ts
    renderer.test.ts
    validator.test.ts
    text-validator.test.ts
    cli.test.ts           # Integration: run CLI, check stdout/stderr
    fixtures/             # Test data
      hero.component.html
      features.component.html
      footer.component.html
      index.page.yaml
      index/
        hero.yaml
        features.yaml
      global.css
  templates/              # Scaffolding skeletons
    component.html
    page.yaml
    global.css
  package.json
  tsconfig.json
  README.md
```

**Why flat**: 17 source files, one directory. No `src/cli/`, `src/core/`, `src/data/`, `src/types/` nesting. The AI writes `import { Component } from './types.js'` not `import { Component } from './types/component.js'`. Fewer paths to get wrong. File names ARE the module names.

**Why all types in one file**: 4–6 interfaces each. Total ~60 lines. Splitting into `types/component.ts`, `types/page.ts`, `types/data.ts`, `types/config.ts` creates 4 files with 15 lines each and cross-reference imports. One file, no circular dependency risk.

---

## 4. Implementation patterns

### 4.1 Error handling: throw `EngineError`

All validation failures throw a custom `EngineError` with structured fields. The CLI entry point catches it and prints to stderr. No Result types, no mixed patterns.

```typescript
// src/types.ts
export class EngineError extends Error {
  constructor(
    message: string,
    public file: string,       // e.g. "data/index/hero.yaml"
    public field?: string,     // e.g. "heading"
    public level: 'ERROR' | 'WARNING' = 'ERROR',
    public help?: string,      // e.g. "Allowed inline tags: ..."
  ) {
    super(message);
  }

  format(): string {
    const loc = this.field ? `${this.file}:${this.field}` : this.file;
    let out = `${this.level} [${loc}]: ${this.message}`;
    if (this.help) out += `\n  ${this.help}`;
    return out;
  }
}
```

**Usage pattern**:
```typescript
throw new EngineError(
  'disallowed tag <script> in text field',
  'data/index/hero.yaml',
  'heading',
  'ERROR',
  'Allowed inline tags: <strong>, <em>, <b>, <i>, <a href="...">, <code>, <br>, <mark>, <del>, <ins>, <sub>, <sup>, <small>'
);
```

The CLI catches it:
```typescript
try {
  const result = renderComponent(name, page);
  process.stdout.write(result);
} catch (e) {
  if (e instanceof EngineError) {
    process.stderr.write(e.format() + '\n');
  } else {
    process.stderr.write(`FATAL: ${e.message}\n`);
  }
  process.exit(1);
}
```

Warnings are collected in an array, not thrown. The CLI prints them all at the end, then exits 0 (unless `--strict`).

### 4.2 CLI routing: explicit `Map`, not commander

```typescript
// src/cli.ts
type Handler = (args: string[]) => Promise<void>;

const handlers: Record<string, Handler> = {
  init:    cmdInit,
  create:  cmdCreate,
  render:  cmdRender,
  validate: cmdValidate,
  build:   cmdBuild,
  diff:    cmdDiff,
  watch:   cmdWatch,
  add:     cmdAdd,
  list:    cmdList,
  preview: cmdPreview,
};

// src/index.ts
const [,, command, ...args] = process.argv;
const handler = handlers[command];
if (!handler) {
  process.stderr.write(`Unknown command: ${command}\nRun: engine --help\n`);
  process.exit(1);
}
await handler(args);
```

**Why not commander**: Commander's option negotiation, middleware, and auto-help add ~5KB of abstraction for something that is literally `switch(command)`. The AI writes a `Map<string, fn>` and a simple arg parser. Transparent control flow, zero magic.

**Argument parsing** within each handler is manual but trivial — most commands take 1–2 positional args and 0–1 flags:

```typescript
async function cmdRender(args: string[]) {
  // engine render component <name> --page <page>
  // engine render page <name> [--compact]
  const subcommand = args[0]; // "component" | "page"
  if (subcommand === 'component') {
    const name = args[1];
    const pageIdx = args.indexOf('--page');
    const page = pageIdx !== -1 ? args[pageIdx + 1] : null;
    // ...
  }
}
```

The `--help` output is a hand-written string. One file (`cli.ts`), one `console.log` per command. No framework to learn.

### 4.3 Logging: `--verbose` and a simple logger

```typescript
// Simple global logger
let verbose = false;
export function setVerbose(v: boolean) { verbose = v; }
export function log(...args: unknown[]) { if (verbose) console.error('[debug]', ...args); }
export function warn(...args: unknown[]) { console.error('[warn]', ...args); }
```

Set `verbose` from a `--verbose` flag early in `index.ts`. The AI sprinkles `log()` calls at decision points during implementation and debugging. Users never see them unless they opt in.

### 4.4 Caching: `.engine-cache.json` schema

```json
{
  "version": 1,
  "pages": {
    "index": {
      "hash": "a1b2c3...",
      "builtAt": "2026-07-04T10:30:00Z",
      "sources": {
        "global.css": "d4e5f6...",
        "components/hero.component.html": "789abc...",
        "data/index/hero.yaml": "def012...",
        "pages/index.page.yaml": "345678..."
      }
    }
  }
}
```

**Hashing**: `crypto.createHash('sha256').update(content).digest('hex')`. Hash the file content as a UTF-8 string, not a buffer — ensures cross-platform consistency.

**Stale detection**: Compare current hashes of all source files for a page against cached hashes. If any differ → stale. If the page's component list changed (a component added/removed) → stale.

### 4.5 Scaffold templates

**`templates/component.html`** (produced by `engine create component <name>`):
```html
<!-- {{name}}.component.html -->

<h2>{{text:heading}}</h2>
<p>{{text:body}}</p>
---
/*
 * CSS — styles scoped to .{{name}}
 * Write selectors naturally; the engine prefixes them with .{{name}}
 */
---
{
  "heading": { "type": "text", "required": true, "maxLength": 120 },
  "body":    { "type": "text", "required": false }
}
```

**`templates/page.yaml`** (produced by `engine create page <name>`):
```yaml
title: "{{name}}"
description: ""
components: []
```

**`templates/global.css`** — the full design tokens + baseline from the spec §6.1, copied verbatim on `engine init`.

**`engine create data <component> --page <page>`** — reads the component's schema from `components/<component>.component.html`, extracts all placeholder names, and creates `data/<page>/<component>.yaml` with every placeholder key present and values set to empty/null:

```yaml
# Generated by: engine create data hero --page about
heading: null      # required, text
subtext: null      # optional, text
cta: null          # optional, html
hero_image:        # optional, image
  src: null
  alt: null
```

The AI fills in the `null` values. This ensures the data file has every key the schema expects — no missing-key errors on first render.

---

## 5. Test strategy

### 5.1 What to test

An AI implementer must verify correctness. The test suite validates:

| Layer | What it tests | File |
|-------|--------------|------|
| **Component parser** | Splitting `---` sections, extracting template/CSS/schema | `component.test.ts` |
| **Template engine** | All 7 placeholder types, list iteration, bool conditional, slot recursion | `template.test.ts` |
| **CSS scoping** | Single selector, multi-selector, already-prefixed skip, empty CSS | `css.test.ts` |
| **Text validator** | Whitelist pass, disallowed tag fail, disallowed attribute fail, block tag fail, `href` preservation | `text-validator.test.ts` |
| **Validator** | Schema validation, missing required, type mismatch, forbidden tags in template | `validator.test.ts` |
| **Renderer** | Page assembly, header/section/footer wrapping, default footer, IDs and classes | `renderer.test.ts` |
| **CLI integration** | `engine render page index` produces expected HTML, `engine validate` exits 0/1, error format | `cli.test.ts` |

### 5.2 Test fixtures

`test/fixtures/` contains a minimal but complete project:

```
test/fixtures/
  engine.config.yaml     # Minimal: { project: { name: "test", lang: "en" }, build: { pretty: true } }
  global.css             # Full design tokens + baseline from spec §6.1
  components/
    hero.component.html  # Has {{text:heading}}, {{text:subtext}}, {{html:cta}}; CSS; schema
    features.component.html  # Has {{#list:items}}; schema
    footer.component.html    # Has {{text:copyright}}; no CSS; schema
  pages/
    index.page.yaml      # title: "Test Page", components: [hero, features, footer]
  data/
    index/
      hero.yaml          # heading: "Hello", subtext: "World", cta: "<a href=\"/\">Go</a>"
      features.yaml      # items: [{title: "One", desc: "First"}, {title: "Two", desc: "Second"}]
      footer.yaml        # copyright: "2026 Test"
```

Fixture files should be minimal but cover all 7 placeholder types across components. The hero component uses `text`, `html`, and optionally `image`/`bool`. The features component uses `list`. The footer uses `text`.

Every test reads from `test/fixtures/`, renders, and asserts against expected output strings. No mocking of filesystem — tests use real files and a temp `build/` directory via `os.tmpdir()`.

### 5.3 Running tests

```bash
npm test              # vitest run (once)
npm run test:watch    # vitest (watch mode, re-run on change)
```

Vitest is chosen over Jest because:
- Native ESM support (no config wrestling)
- TypeScript out of the box (tsx under the hood)
- Jest-compatible API (`describe`, `it`, `expect`)
- Faster startup

---

## 6. Implementation order

The AI should build in this sequence — each step produces testable output:

| Step | What | Testable output |
|------|------|----------------|
| 1 | `types.ts` — all interfaces | TypeScript compiles |
| 2 | `config.ts` — parse `engine.config.yaml` | Returns typed config object |
| 3 | `component.ts` — parse component files (3-section split) | Returns `{ template, css, schema }` |
| 4 | `template.ts` — custom template engine | `render(template, data)` returns HTML string |
| 5 | `text-validator.ts` — tag whitelist | `validateText(value)` throws or returns |
| 6 | `css.ts` — CSS scoping + assembly | `scopeCSS(css, className)` returns prefixed CSS |
| 7 | `data-file.ts` — YAML data file loading | `loadData(page, component)` returns data object |
| 8 | `schema.ts` — ajv validation wrapper | `validate(schema, data)` returns errors array |
| 9 | `validator.ts` — all build-time checks | `validateComponent()`, `validatePage()` throw EngineError |
| 10 | `page.ts` — page YAML parser | Returns typed Page object |
| 11 | `renderer.ts` — page assembly | `renderPage(name)` returns full HTML string |
| 12 | `hasher.ts` — caching | `isStale(page)` returns boolean |
| 13 | `propagation.ts` — change detection | `affectedPages(changedFile)` returns page names |
| 14 | `copier.ts` — asset copy | Copies `assets/` → `build/assets/` |
| 15 | `scaffold.ts` — `engine create` commands | Creates files from templates |
| 16 | `cli.ts` + `index.ts` — CLI routing | `npm run dev render page index` works |
| 17 | Integration: `engine init` → create → render → build | Full pipeline |

Each step is a single file. The AI can implement, test, and verify correctness before moving to the next. No step depends on more than 2 prior steps.

---

## 7. Edge cases & gotchas for AI implementer

### 7.1 CSS scoping gotchas

- **`@media` rules**: Component CSS inside an `@media` block gets scoped INSIDE the media query, not outside.
  ```css
  /* Input (hero component CSS) */
  @media (max-width: 768px) {
    h1 { font-size: 2rem; }
  }
  /* Output: class prefix goes on selectors inside @media, not before @media */
  @media (max-width: 768px) {
    .hero h1 { font-size: 2rem; }
  }
  ```
  Putting `.hero` before `@media` (e.g. `.hero @media (...) { ... }`) is invalid CSS and will be ignored by browsers.
- **`@keyframes`**: Keyframe names are NOT prefixed. `@keyframes fade { ... }` stays as-is. The animation name referenced in `animation: fade 1s` is also left alone.
- **`@font-face`**: Not prefixed. Pass through unchanged.
- **Comments**: `/* comment */` inside rules should be preserved, not stripped.

### 7.2 HTML parsing caveat: templates are NOT valid HTML

Component templates contain `{{placeholder}}` syntax which is not valid HTML. The parse order matters:

1. **Template parsing**: Read the raw template string, extract placeholders with regex. This happens BEFORE HTML parsing.
2. **Placeholder resolution**: Replace `{{text:heading}}` with the actual text value.
3. **HTML parsing**: Only NOW parse the resolved HTML string with `node-html-parser` — for structure validation, CSS leakage detection, and final assembly.

`node-html-parser` should never see a raw `{{placeholder}}`. If it does, it may treat `{{` as text content, close tags prematurely, or produce a mangled DOM tree.

### 7.3 Template engine gotchas

- **Nested blocks**: `{{#list:items}}{{#bool:show}}...{{/bool:show}}{{/list:items}}` — blocks can nest. Use a stack, not regex.
- **Empty lists**: `{{#list:items}}...{{/list:items}}` with `items: []` produces empty string, not an error.
- **`this` scope in lists**: `{{text:this}}` only works when list items are scalars. If items are objects, `this` is undefined — use `{{text:fieldName}}`.
- **Whitespace around delimiters**: `{{text:name}}` is the token. `{{ text:name }}` is also valid (trim whitespace inside `{{ }}`). `{{text:name}} ` (trailing space) is part of the surrounding text.

### 7.4 Validation gotchas

- **Order of checks matters**: Parse errors first (malformed YAML, bad JSON), then schema errors (missing required), then content errors (disallowed tags). This gives the AI the most specific error first.
- **Warnings don't block rendering**: Only ERRORs stop the build. Warnings print to stderr but the page still renders.
- **`--strict` flag**: When set, warnings become errors. Controlled by `validation.strict` in `engine.config.yaml`.

### 7.5 File watching gotchas

- **Debounce**: `chokidar` fires multiple events for a single save (especially on macOS). Debounce 100ms before triggering rebuild.
- **Ignore `build/`**: Watching must exclude the build directory — otherwise every build triggers another build loop.
- **Ignore `node_modules/` and `.engine-cache.json`**: Avoid unnecessary rebuild triggers.

### 7.6 General gotchas

- **Node version guard**: Check `process.version` at startup in `index.ts`. If `< 22`, print `Engine requires Node.js ≥ 22 (current: {version})` and `process.exit(1)`.
- **`bin` field**: `package.json` `bin.engine` points to `./dist/index.js` — this only works after `tsc` build and `npm link`. During development, use `npx tsx src/index.ts <command>` or `npm run dev`. Do NOT run `engine` from `./dist/` during development.
- **`engine init` creates directories**: Creates `engine.config.yaml`, `global.css`, and empty `components/`, `pages/`, `data/`, `assets/` directories. Does NOT create `build/` — that's generated on first `engine build`.
- **Help text sync**: The `--help` output is hand-written in `cli.ts`. Keep it in sync with the `handlers` map. Prefer auto-generating help from a list of `{ command, description }` entries rather than a free-text string.
- **Warnings vs Errors in EngineError**: The `EngineError` class has a `level` field. Use `level: 'ERROR'` for thrown errors. Use a SEPARATE array (`warnings: EngineError[]`) collected during validation for non-blocking issues with `level: 'WARNING'`. Warnings are never thrown — they're pushed to the array, printed to stderr at the end, and don't block rendering (unless `--strict`).
- **Missing data file is not an error**: If `data/<page>/<component>.yaml` doesn't exist when rendering, treat it as an empty data object `{}`. The component renders with schema defaults for optional fields; required fields without defaults trigger a schema validation error.
- **Missing data directory**: If `data/<page>/` doesn't exist at all when rendering a page, treat all components on that page as having empty data `{}`. The page renders; missing required fields produce errors.

---

## 8. Future dependencies — assessed for §11 impact

| §11 item | Library needed? | Why it adds no complexity now |
|----------|----------------|------------------------------|
| #1 Nested components | No | Already in the custom template engine's recursive slot resolution |
| #2 Responsive breakpoints | No | `@media` passthrough in CSS scoping already handles this |
| #3 Component variants | No | Conditional CSS at build time, no new parsing |
| #4 `<nav>` support | No | One `if` branch in `renderer.ts` |
| #5 Multi-page data | No | Extend `data-file.ts` resolution order |
| #6 Incremental builds | No | Already have `hasher.ts` + `propagation.ts` |
| #7 HTML-aware diff | No | Already have `node-html-parser` for DOM comparison |
| #8 `engine serve` | `node:http` (stdlib) + tiny WebSocket lib | Stdlib `http.createServer` serves `build/` directory in ~10 lines. Livereload: inject `<script>` that polls or uses SSE. **No express needed.** |
| #9 i18n | No | Extend `data-file.ts` with language suffix resolution |
| #10 `markdown` type | `marked` (~50KB) + `sanitize-html` | Markdown→HTML via `marked.parse(md)`, then sanitize against extended whitelist. Both packages ship their own TypeScript types. |

**No future feature requires a dependency that changes the architecture.** Every §11 item maps to extending an existing module, not adding a new paradigm.

---

## 9. Summary for AI implementer

```
Language:        TypeScript (strict)
Runtime:         Node.js ≥ 22
Runner:          tsx (dev), tsc (build)
Test:            vitest
Total deps:      5 production, 5 dev = 10 total
Source files:    17 .ts files total (including types.ts)
Test files:      7 .test.ts files
Templates:       3 scaffold files
CLI routing:     Map<string, handler> — no framework
HTML parsing:    node-html-parser (standard DOM API)
CSS scoping:     Custom string manipulation (~30 lines)
Templating:      Custom recursive descent (~100 lines)
Error handling:  throw EngineError, catch at CLI boundary
Caching:         .engine-cache.json with SHA-256 hashes
Build order:     17 steps, each testable independently
```

**Start here**: `npm init`, install the 5 production deps, create `src/types.ts`, then follow §6 step by step. Each step has a corresponding test file. Green tests = move to next step.
