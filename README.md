# htmlng — HTML Pages AI Agents Can't Break

**Edit components. Not pages. Never break a footer again.**

htmlng is a deterministic HTML engine built for AI agents. You edit isolated component templates and YAML data files. The engine assembles pages. Every build is a pure function of source — same inputs, same output, always. Zero risk of an AI edit cascading into collateral damage.

```bash
htmlng create component hero --preset hero    # scaffold from your design library
htmlng create data hero --page index          # generate typed content file
htmlng render page index                      # see the full page before building
htmlng build && htmlng serve --watch          # ship it, watch it reload
```

## Install

```bash
git clone https://github.com/KobraRocks/htmlng.git
cd htmlng
./install.sh
```

## Quick Start

```bash
htmlng init --name "My Site"
htmlng create component hero
htmlng create component features
htmlng create component footer
htmlng create page index
htmlng add component hero --page index
htmlng add component features --page index
htmlng add component footer --page index
htmlng create data hero --page index
htmlng create data features --page index
htmlng create data footer --page index

# Edit data/index/hero.yaml with your content, then:
htmlng render component hero --page index   # validate one component
htmlng render page index                    # validate full assembly
htmlng build                                # write to disk
```

## Commands

| Command | Description |
|---------|------------|
| `htmlng init [--name <n>]` | Initialize a new project |
| `htmlng create component <name> [--preset <p>]` | Scaffold a new component (from preset if specified) |
| `htmlng create page <name>` | Scaffold a new page |
| `htmlng create data <c> --page <p>` | Scaffold a data file |
| `htmlng render component <c> --page <p>` | Render component inner HTML to stdout |
| `htmlng render component <c> --all` | Render component across all pages |
| `htmlng render component <c> --page <p> --with-css` | Render with compiled CSS for style preview |
| `htmlng render page <p> [--compact]` | Render full page to stdout |
| `htmlng preview component <c> [--with-css]` | Preview with sample data |
| `htmlng validate` | Validate all pages and components (exits non-zero on errors) |
| `htmlng build [page <p>]` | Write pages to build/ directory (wipes build/ when building all; use `build <p>` for one page) |
| `htmlng diff [page <p>]` | Show unified diff vs last build |
| `htmlng add component <c> --page <p>` | Add component to page |
| `htmlng move component <c> --page <p> --before\|--after <other>` | Reorder component in page |
| `htmlng save component <c> --as-preset <name>` | Save component as reusable preset |
| `htmlng list presets` | List available presets |
| `htmlng watch` | Watch files, rebuild, and write to build/ on change |
| `htmlng serve [--port <n>] [--watch]` | Start dev server on build/ directory (--watch enables hot reload) |
| `htmlng css <page>` | Print assembled CSS (global + all component styles) for a page |
| `htmlng context` | Print the whole project map as JSON (pages, components, data shapes, tokens, staleness) |
| `htmlng schema` | Print the machine-readable file-format spec as JSON |
| `htmlng explain [<code>]` | Explain an error code (lists all codes when omitted) |

## How It Works

Pages are assembled from three things:

1. **Component templates** (`components/*.component.html`) — HTML with `{{placeholders}}` and scoped CSS
2. **Page layouts** (`pages/*.page.yaml`) — ordered list of component names
3. **Data files** (`data/<page>/<component>.yaml`) — content for each component on each page

The engine enforces strict isolation: editing component X's template, CSS, or data has zero structural impact on component Y.

### Component file format

```html
<h1>{{text:heading}}</h1>
<p>{{text:subtext}}</p>
{{html:cta}}
---
h1 { font-size: 3rem; }
---
{
  "heading": { "type": "text", "required": true, "maxLength": 120 },
  "subtext": { "type": "text", "required": false },
  "cta": { "type": "html", "required": false }
}
```

Three sections separated by `---`: template, CSS (scoped automatically), JSON schema. An empty CSS section (two consecutive `---` lines) is allowed.

### Semantic component authoring

The engine wraps every component in a semantic tag carrying the component's `id` and `class`. **Your template is the inner content only** — do not add a wrapper `<div class="<component-name>">`, because the engine already emits it and the validator warns (`COMPONENT_REDUNDANT_WRAPPER`).

```html
<!-- ✅ Good: inner content only -->
<h2>Executive Summary</h2>
{{html:body}}

<!-- ✅ Good: a grouping element is fine when it is not the component wrapper -->
<div class="meta">
  <span>{{text:date}}</span>
  <span>{{text:audience}}</span>
</div>
<h2>{{text:heading}}</h2>

<!-- ❌ Bad: duplicates the engine wrapper -->
<div class="exec-summary">
  <h2>Executive Summary</h2>
  {{html:body}}
</div>

<!-- ❌ Bad: div soup instead of semantic elements -->
<div class="features-wrapper">
  <div class="features-list"><ul>...</ul></div>
</div>
```

Assembly (`renderer.ts`): the wrapper is chosen by component **name**, not position — a component named `header` renders as `<header id="header" class="header">`, `footer` as `<footer ...>`, and every other component as `<section id="<name>" class="<name>">`. Sequence-data elements get `id="<name>-<index>"`. A default footer is appended only when the page has no component named `footer`.

### Placeholder types

| Type | Syntax | Use |
|------|--------|-----|
| `text` | `{{text:name}}` | Text with safe inline formatting |
| `html` | `{{html:name}}` | Raw HTML for block content |
| `image` | `{{image:name}}` | `<img>` element (content only, never an attribute value) |
| `link` | `{{link:name}}` | `<a>` element (content only, never an attribute value) |
| `list` | `{{#list:name}}...{{/list:name}}` | Repeated items inside one component instance |
| `bool` | `{{#bool:name}}...{{/bool:name}}` | Renders only when the value is exactly `true` |
| `if` / `unless` | `{{#if:name}}...{{/if:name}}` | Renders on truthiness / falsiness in the component's data scope |
| `slot` | `{{slot:name}}` | Nested component (content only, never an attribute value) |

### Page structure

The wrapper tag follows the component name: `header` → `<header>`, `footer` → `<footer>`, everything else → `<section id="name" class="name">`. Sequence data files repeat the whole component once per element (`id="<name>-0"`, `-1`, …); `{{#list:name}}` instead repeats a block inside one instance, and its item fields are not schema fields. Element placeholders (`image`, `link`, `slot`) must be element content — `<span class="logo">{{image:logo}}</span>`, not `src="{{image:logo}}"`, which is a `COMPONENT_PLACEHOLDER_IN_ATTRIBUTE` error.

### Page identity, layout, and scripts

Every page emits `<body class="<page>" data-page="<page>">`, so CSS can scope to one page with `body.<page> …`. Optional page YAML:

```yaml
layout:
  bodyClass: "deck slide-1"   # appended after the page name
  wrapper: true               # wrap all component wrappers in <div id="page" class="page">
scripts:
  - src: "assets/js/nav.js"        # default: end of <body>, DOM available
  - src: "assets/js/analytics.js"
    head: true                     # → <head>, with defer added unless defer/async is set
```

`layout.wrapper: true` gives you one container to own flex/grid layout, a fixed canvas, or a print size; the validator allows that `<div id="page">` plus page scripts as direct body children. `list pages`, `context`, and build-all enumerate pages in **natural sort order** (`slide-1`, `slide-2`, `slide-10`). Component CSS is still auto-prefixed with `.<name>`, except selectors starting with `html`/`body`/`:root`/`:host` and selectors led by `:global(...)`, which are emitted unscoped — `body { display: flex }` stays `body { display: flex }`, `:global(.leaflet-container) { z-index: 1 }` becomes `.leaflet-container { z-index: 1 }`. A `:global(...)` later in a selector exempts only the wrapped compound: `.card :global(.selected)` becomes `.hero .card .selected`.

### Print and fixed-canvas output

`vh`/`vw` are not print-safe (Chromium resolves them against the print viewport and fixed slides reflow). Use `layout.wrapper: true` with fixed `px` sizes and add `@page { size: 1280px 720px; margin: 0 }` to `global.css`. A built-in `--pdf` export is deliberately not implemented — it would require a headless-browser dependency. `examples/deck/` is the known-good reference for this pattern.

### Design tokens

Global styles are driven by `design-tokens.yaml`. Edit values and rebuild — all components pick up the changes instantly:

```yaml
# design-tokens.yaml
primary: "#1a1a2e"      # brand color
font-size-h1: "3rem"    # heading size
space-xl: "6rem"        # section spacing
```

`global.css` uses `{{token-name}}` placeholders resolved at build time.

### Single-file output (inlined CSS)

Set `build.inlineCSS: true` in `engine.config.yaml` to emit the CSS in a `<style>` tag instead of a separate `build/css/<page>.css` file — useful for self-contained reports you can move or email as one file:

```yaml
# engine.config.yaml
paths:
  build: "build"         # single path segment (no "/" or ".."); wiped when building all pages
build:
  inlineCSS: true
validation:
  strict: false          # treat warnings as errors
  requireAltText: true   # image placeholders must provide alt
```

## Built for agents

Every command supports `--json` for machine-readable output, errors carry stable
codes, and three discovery commands replace guesswork:

```bash
htmlng context                 # whole project map: pages, components, data shapes, tokens, staleness
htmlng schema                  # machine-readable file-format spec
htmlng explain SCHEMA_VALIDATION   # what an error code means and how to fix it
htmlng --json validate         # {"ok":false,"errors":[{"code":"SCHEMA_VALIDATION", ...}]}
htmlng --json build            # {"ok":true,"pages":["index"],"warnings":[]}
```

`--strict` (or `validation.strict: true` in config) makes warnings fail the command.
`validate` exits non-zero whenever any error is present and never reports success on
failure. `htmlng explain <CODE>` covers every code the engine emits; array-data diagnostics
name the failing element (`element [2] /body must be string`), stale data files warn
`DATA_FILE_ORPHAN` from `build`, `render page`, and `validate`, and duplicate warnings
are reported once.

## Docs

- [Functional specification](specs/html-engine.md)
- [Technology stack](specs/stack.md)
- [Implementation plan](specs/implementation-plan.md)

## Dev

```bash
npm test              # 156 tests
npm run typecheck     # tsc --noEmit
npm run dev           # run without building
```
