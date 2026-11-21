---
name: htmlng
description: >
  REQUIRED for building and editing static HTML pages via the component-based HTML htmlng CLI.
  Use when the user asks to create, edit, or render web pages, landing pages, marketing sites,
  or any HTML output where deterministic component isolation is needed. The htmlng assembles
  pages from isolated components with scoped CSS — AI agents edit only component templates
  and data files, never raw HTML. Triggers: html engine, render page, create component,
  edit page, build html, scaffold page, component template, placeholder data, htmlng render,
  htmlng build, htmlng validate, htmlng create.
---

# HTML Engine Skill

Deterministic component-based HTML page generator. AI agents edit component templates and data files; the htmlng assembles pages with zero risk of collateral damage to other components.

## Project location

The htmlng is globally installed. Run commands from any project directory:

```bash
htmlng <command>
```

If the `htmlng` tool is unavailable, run the engine directly: `node <engine-checkout>/dist/index.js <command>` with the project as cwd, where `<engine-checkout>` is the htmlng checkout that contains `dist/`.

## Commands

### Project setup

```bash
htmlng init [--name <name>]           # Initialize a new project
```

### Scaffolding

```bash
htmlng create component <name> [--preset <p>]  # Scaffold from generic or preset
htmlng create page <name>             # Scaffold a new page
htmlng create data <c> --page <p>     # Scaffold a data file (reads schema, fills keys)
htmlng save component <name> --as-preset <p>  # Save component as reusable preset
```

### Rendering (stdout)

```bash
htmlng render component <c> --page <p>  # Render one component's inner HTML
htmlng render component <c> --page <p> --with-css  # Render with compiled CSS for style preview
htmlng render component <c> --all       # Render component across all pages
htmlng render page <p> [--compact]      # Render full HTML page
htmlng preview component <c> [--with-css]  # Preview with sample data
```

### Validation

```bash
htmlng validate                        # Validate all pages and components
htmlng validate page <p>              # Validate one page
htmlng validate component <c>         # Validate one component
```

`validate` exits non-zero on any error and prints `Validation failed: N error(s).`
Only a clean run prints `Validation passed.` Use the exit code (or `--strict` to
also fail on warnings) to decide whether to build.

### Build & Diff

```bash
htmlng build [page <p>]               # Write pages to build/ directory
htmlng diff [page <p>]                # Show unified diff vs last build
```

### Utility

```bash
htmlng add component <c> --page <p>    # Add component to page
htmlng move component <c> --page <p> --before|--after <other>  # Reorder component
htmlng list pages|components|data [<p>] # List resources
htmlng list presets                   # List available presets
htmlng watch                           # Watch, rebuild, and write to build/ on change
htmlng serve [--port <n>] [--watch]    # Start dev server (--watch auto-reloads on file change)
htmlng context                         # Whole project map as JSON (pages, components, data shapes, tokens, staleness)
htmlng schema                          # Machine-readable file-format spec as JSON
htmlng explain [<code>]                # Explain an error code (lists all codes when omitted)
```

### Machine-readable output (preferred for agents)

Add `--json` to `validate`, `build`, `render`, `preview`, `list`, `diff`, and the
scaffolding commands to get a single JSON object on stdout:

```bash
htmlng --json validate
# {"ok":false,"errors":[{"code":"SCHEMA_VALIDATION","level":"ERROR",
#   "file":"data/index/hero.yaml","message":"Schema validation failed: /heading must be string (got number)"}],
#  "warnings":[]}

htmlng --json build          # {"ok":true,"pages":["index"],"warnings":[]}
htmlng --json render page index   # {page, components, html, status, changed, warnings}
```

Every error carries a stable `code`; run `htmlng explain <code>` for the meaning and a
fix recipe. `htmlng context` and `htmlng schema` always emit JSON.

**Discover before you guess:** `htmlng context` is the fastest way to learn which pages,
components, data files, and tokens exist before editing.

## Design tokens

Global styles are driven by `design-tokens.yaml`. Edit values and rebuild:

```yaml
primary: "#1a1a2e"      # brand color — changes all components
font-size-h1: "3rem"    # heading size
space-xl: "6rem"        # section spacing
```

`global.css` uses `{{token-name}}` placeholders resolved at build time.

## Workflow for AI agents

### Editing copy/content on an existing page

```
1. Edit data/<page>/<component>.yaml (change heading, subtext, etc.)
2. htmlng render component <component> --page <page>
3. Inspect stdout — confirm the changed content looks correct
4. If wrong → fix the YAML → re-run step 2
5. htmlng render page <page>          (validate full assembly)
6. htmlng build                        (write to disk)
```

### Creating a new page

```
1. htmlng create page <name>
2. Edit pages/<name>.page.yaml (set title, description, components list)
3. For each component:
   a. htmlng create data <component> --page <name>
   b. Edit data/<name>/<component>.yaml (fill content)
   c. htmlng render component <component> --page <name> (validate)
4. htmlng render page <name>           (validate full assembly)
5. htmlng build                        (write to disk)
```

### Repeating a component with different data (array data files)

When you need the same component multiple times on one page with different data,
use an **array** data file instead of creating copy-pasted component files:

```yaml
# data/<page>/report-section.yaml — an ARRAY (YAML sequence)
- heading: "Section 1: Introduction"
  body: "<p>First section content...</p>"
- heading: "Section 2: Analysis"
  body: "<p>Second section content...</p>"
- heading: "Section 3: Conclusion"
  body: "<p>Third section content...</p>"
```

The page YAML lists the component **once**:

```yaml
components:
  - report-header
  - report-section    # ← renders 3 times, once per array element
  - report-footer
```

Each array element generates a separate `<section>` with an indexed ID:
`<section id="report-section-0">`, `<section id="report-section-1">`, etc.
All share the component's CSS class (`class="report-section"`).

**Rules:**
- Array data files replace the need for copy-pasted `section-1`, `section-2`, etc.
- Each array element must be an object with the same placeholder keys as the component schema
- The component appears once in the page YAML — the engine handles repetition
- Use `htmlng render component <name> --page <page>` to inspect all rendered items

#### Array data file vs `{{#list:...}}`

These are different tools — pick by *what* repeats:

| Goal | Use | Schema shape |
|------|-----|--------------|
| Repeat the **whole component** N times | a YAML **sequence** data file | Flat: the placeholder fields sit at the top level of each element. One wrapper per element, ids `<name>-0`, `<name>-1`, … (a single-element array also gets `-0`). |
| Repeat a **block inside one instance** | `{{#list:name}}...{{/list:name}}` | A `list` field in the component schema. Item fields are read with `{{text:field}}` (or `{{text:this}}` for scalars) and are **not** component schema fields. |

A nested `"items": {"type": "list", "item": {"title": {...}}}` item schema is **not supported** — it fails with `COMPONENT_PLACEHOLDER_TYPE` telling you to flatten the schema or switch to a sequence data file.

### Creating a new component

**Before writing any CSS**, inspect what already exists:

```
0. PRE-FLIGHT — understand the styling landscape:
   a. Read global.css — know what semantic elements are already styled (h1–h6, p, a, ul, etc.)
   b. htmlng css <page> — see the full assembled CSS for the target page
   c. Read 1–2 sibling component CSS blocks — learn the project's patterns
   d. Ask: can I reuse an existing component with different data instead of creating a new one?
      (e.g., section-1 through section-7 should be one reusable report-section component)

1. htmlng create component <name> [--preset <p>]
   Use --preset if a reusable base exists (e.g., --preset report-section)
2. Edit components/<name>.component.html:
   - Template: HTML with {{text:field}}, {{#list:items}}...{{/list:items}}, etc.
     Do NOT add a wrapper <div class="<name>"> — the engine provides the semantic wrapper.
   - CSS (after first ---): ONLY styles unique to this component.
     Skip anything already covered by global.css (typography, spacing, colors on semantic elements).
     The engine scopes with .<name> prefix automatically.
   - Schema (after second ---): JSON with placeholder definitions
3. htmlng add component <name> --page <page>
4. htmlng create data <name> --page <page>
5. Edit data/<page>/<name>.yaml
6. htmlng render component <name> --page <page>
7. htmlng render page <page>
8. htmlng build
```

### CSS authoring rules

**Golden rule: only write CSS that is unique to this component.** Everything else belongs in `global.css` or doesn't need to be restated.

✅ **Put in global.css** (applies to all components):
- Typography: `h1`–`h6`, `p`, `a`, `strong`, `em`, `code`
- Spacing defaults: `margin-bottom` on `p`, `ul`, `ol`
- Color system: text, muted text, links, backgrounds
- Layout primitives: `header, section, footer { max-width; margin: 0 auto; padding }`
- Table styling, blockquotes, horizontal rules

✅ **Put in component CSS** (unique to this component):
- Layout that differs from the baseline (e.g., a grid, flex layout, or sticky header)
- Component-specific overrides (e.g., `h1 { font-size: 3rem }` when the baseline is 2.5rem)
- Decorative elements unique to the component (borders, backgrounds, special spacing)
- Interactive states unique to the component

❌ **Never repeat** across multiple components:
- The same max-width + margin rule in every component → belongs in `global.css`
- The same flex/grid pattern in multiple components → create a reusable component or preset
- The same padding/spacing pattern → use design tokens from `design-tokens.yaml`

**Inspecting CSS**: Use `htmlng css <page>` to see the full assembled CSS (global + all component styles) for any page. This reveals duplication and helps you decide whether a style belongs in `global.css` or should be a shared preset.

**Scoping escape hatch.** Component CSS is prefixed with `.<name>`, except:

- selectors whose first compound starts with `html`, `body`, `:root`, or `:host` are emitted **unscoped** (a `.name ` prefix could never match them);
- a selector that *begins* with `:global(...)` is emitted unscoped with `:global(...)` unwrapped (a whole-selector opt-out);
- a `:global(...)` elsewhere in a selector exempts only the wrapped compound; the surrounding local compounds stay scoped;
- `@page` passes through verbatim.

```css
/* component CSS input            → assembled output */
body { display: flex; }           /* → body { display: flex; } */
:global(.leaflet-container) { z-index: 1; } /* → .leaflet-container { z-index: 1; } */
.card :global(.selected) { color: red; }    /* → .hero .card .selected { color: red; } */
h1 { font-size: 3rem; }           /* → .hero h1 { font-size: 3rem; } */
```

### Changing global styles

```
1. Edit global.css (design tokens or semantic element baselines)
2. htmlng render page <page>           (validate cascade)
3. htmlng build                        (rebuild all pages)
```

## Placeholder types

| Type | Template syntax | Data shape | Notes |
|------|----------------|------------|-------|
| `text` | `{{text:name}}` | `string` | Allows inline tags: `<strong>`, `<em>`, `<a href>`, `<code>`, `<br>`, etc. Other tags rejected. |
| `html` | `{{html:name}}` | `string` | Raw HTML, unsanitized. Use for blog posts, complex markup. |
| `image` | `{{image:name}}` | `{src, alt, width?, height?, loading?, class?}` | Emits a whole `<img>` element — content only, never an attribute value |
| `link` | `{{link:name}}` | `{href, label, class?}` | Emits a whole `<a>` element — content only, never an attribute value |
| `list` | `{{#list:name}}...{{/list:name}}` | `array` | Iterates an array inside ONE instance. Objects → `{{text:field}}`. Scalars → `{{text:this}}`. Item fields are not schema fields. |
| `bool` | `{{#bool:name}}...{{/bool:name}}` | `boolean` | Renders block only if the value is exactly `true` |
| `if` | `{{#if:name}}...{{/if:name}}` | `any` | Renders block when truthy: `true`, non-blank string, non-empty array/object, non-zero number. Shares the component data scope. |
| `unless` | `{{#unless:name}}...{{/unless:name}}` | `any` | Inverse of `if` |
| `slot` | `{{slot:name}}` | `{component, data?}` | Embeds another component inline; emits an element — content only, never an attribute value |

`if`/`unless` replace the old "pass a class name through data" and "delete the schema field to silence a warning" workarounds: keep the field in the schema, guard it in the template. They are block guards over an existing field, not schema entry types — declare the field with its real type (`text`, `bool`, `list`, …).

**Element placeholders are content.** `{{image:x}}`, `{{link:x}}`, and `{{slot:x}}` emit a complete element, so `src="{{image:logo}}"` is a `COMPONENT_PLACEHOLDER_IN_ATTRIBUTE` error. Put them in the element body and size the box with CSS:

```html
<span class="logo">{{image:logo}}</span>
```
```css
.logo img { height: 2rem; width: auto; }
```

## Text field HTML whitelist

`text` fields allow these inline tags (everything else is rejected with an error):

`<strong>`, `<b>`, `<em>`, `<i>`, `<a href="...">`, `<code>`, `<br>`, `<mark>`, `<del>`, `<ins>`, `<sub>`, `<sup>`, `<small>`

Only `href` is allowed on `<a>`. No other attributes on any tag. Block-level tags (`<div>`, `<p>`, `<h1>`, etc.) produce an error suggesting to use `{{html:field}}` instead.

### Changing global styles (design tokens)

```
1. Edit design-tokens.yaml (change colors, fonts, spacing)
2. htmlng build                        (rebuild all pages)
3. htmlng serve --watch                (auto-reload on changes)
```

### Previewing component styling

```
1. Edit components/<name>.component.html CSS section
2. htmlng render component <name> --page <page> --with-css
3. Save output to .html file and open in browser
4. Or: htmlng preview component <name> --with-css (sample data)
```

## Page identity, layout, and scripts

The engine always emits `<body class="<page>" data-page="<page>">`, so page CSS can scope to one page with `body.<page> …` — no post-build script. Optional page YAML:

```yaml
layout:
  bodyClass: "deck slide-1"   # appended after the page name: class="<page> deck slide-1"
  wrapper: true               # wrap every component wrapper in <div id="page" class="page">
scripts:
  - src: "assets/js/nav.js"        # default: emitted at the END of <body>, DOM available
  - src: "assets/js/analytics.js"
    head: true                     # moves to <head> and adds defer unless defer/async is set
```

- `layout.wrapper: true` gives you one container to own flex/grid layout, a fixed canvas, or a print size. The validator allows that `<div id="page">` plus page `<script>` tags as direct body children.
- Page names are **naturally sorted** (`slide-1`, `slide-2`, `slide-10`) by `htmlng list pages`, `htmlng context`, and build-all.

## Print and fixed-canvas output

`vh`/`vw` are **not print-safe**: Chromium resolves them against the print viewport, so a fixed slide reflows. For print/PDF use `layout.wrapper: true` with fixed `px` sizes, and add `@page { size: 1280px 720px; margin: 0 }` to `global.css`. There is deliberately no built-in `--pdf` export — it would require adding a headless-browser dependency.

`examples/deck/` in the htmlng repo is the known-good reference for this pattern: two fixed 1280×720 slides with `layout.wrapper: true`, `layout.bodyClass: "deck"`, a body-end `assets/deck-nav.js` script, and the `@page` rule in `global.css`.

## Project structure

```
project/
  engine.config.yaml    # Project settings
  global.css            # CSS template with {{token}} placeholders
  design-tokens.yaml    # Design token values (colors, fonts, spacing)
  components/           # *.component.html files (template | CSS | schema)
  pages/                # *.page.yaml files (title, components list, head, scripts)
  data/                 # <page>/<component>.yaml files (placeholder values)
  assets/               # Static files (images, fonts) — copied to build/
  build/                # Rendered output (generated by htmlng build)
```

## Error handling

Errors print to stderr in format: `LEVEL [file:field]: message`. The AI reads the error, fixes the input, and re-runs.

Common errors:
- `Schema validation failed: /field must be string` — data file has wrong type or null instead of empty string
- `Disallowed tag <script> in text field` — text field contains forbidden HTML tag
- `Block-level tag <div> not allowed in text field` — use `{{html:field}}` instead
- `Unsafe link href in "x": "javascript:" URLs are not allowed` — use http(s), mailto, tel, `#fragment`, or a relative path
- `Image "x" is missing alt text` — add `alt:` (empty string is allowed), or set `validation.requireAltText: false`
- `Component not found` — component name typo or file missing

Diagnostics:
- Array-data schema errors name the failing element: `element [2] /body must be ...`.
- `validate` warns `DATA_FILE_ORPHAN` for a `data/<page>/<component>.yaml` whose component the page no longer lists.
- Warnings are de-duplicated, so each problem is reported once.
- `htmlng render component` always prints `=== STATUS: rendered` — read-only render is always fresh and never claims `cached`.

Run `htmlng explain <CODE>` for the full catalog (codes appear in `--json` output); `explain` covers every code the engine emits.

## Important constraints

- **Never edit `build/` directly** — it's regenerated from source on every `htmlng build`
- **Wrapper tags follow the component NAME, not page position** — a component named `header` → `<header id="header" class="header">`, `footer` → `<footer ...>`, every other component → `<section id="<name>" class="<name>">`. Array data elements get `id="<name>-<index>"`. A default `<footer id="footer">` is appended only when no component named `footer` exists.
- **Component CSS is auto-scoped** — write `h1 { ... }` and the htmlng emits `.hero h1 { ... }`; selectors starting with `html`/`body`/`:root`/`:host` and selectors led by `:global(...)` are emitted unscoped, while a `:global(...)` later in a selector exempts only that compound (see the escape hatch above)
- **Global CSS sets baseline** — `global.css` defines typography, colors, spacing for all semantic elements
- **Component files are three sections** separated by `---`: template, CSS (optional), JSON schema
- **`paths.build` is a single path segment** (no `/` or `..`) and is wiped when building all pages
