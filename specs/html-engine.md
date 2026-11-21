# HTML Engine — Functional Specification

> **Target**: AI agents producing deterministic, component-isolated web pages.  
> **Status**: draft  
> **Created**: 2026-07-04  
> **Updated**: 2026-07-04 (review pass — placeholder specs, config, scaffolding, assets, head extensibility)

---

## 1. Philosophy & Problem Statement

### 1.1 The Problem

AI agents are inherently non-deterministic. When asked to "change the hero headline," an agent rewriting raw HTML may:

- Regenerate surrounding markup, altering adjacent sections
- Change a CSS selector that leaks into the footer
- Break layout because it doesn't see the full page context
- Introduce subtle inconsistencies across pages that share components

The result: **every edit is a risk of unintended change**.

### 1.2 The Insight

Determinism is achieved not by making the AI more precise, but by **eliminating the surface area for collateral damage**. If the unit of editing is the component — not the page — then the AI can only touch what you intend it to touch. The engine enforces isolation; the agent works within safe boundaries.

### 1.3 Core Principles

| Principle | Meaning |
|-----------|---------|
| **Component isolation** | Editing component X has zero structural impact on component Y |
| **Page as assembly** | Pages reference components; they contain no content themselves |
| **Scoped CSS** | Component styles are class-prefixed — no global selectors leak |
| **Deterministic rendering** | Same inputs → same output, always |
| **AI-first ergonomics** | File names = component IDs, placeholders are typed and constrained |
| **Semantic purity** | `body` direct children are only `header`, `section[id]`, `footer`, page scripts, and at most one `<div id="page">` layout wrapper |

---

## 2. Constraints

### 2.1 Inherited (given)

| #   | Constraint                                                                                                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Pure semantic HTML — no frameworks, no `<div>` soup. For example cards can be represented by a list `<ul>` and `<li>` as card                                               |
| C2  | Every section carries an `id` for direct navigation                                                                                                                         |
| C3  | A component named `header` is wrapped in `<header id="header" class="header">` — the wrapper role comes from the component **name**, never its position in the page |
| C4  | A component named `footer` is wrapped in `body>footer`; the built-in default `<footer id="footer">` is appended only when no component named `footer` exists                  |
| C5  | Each section is a component, identified by its class                                                                                                                        |
| C6  | Nested CSS scoped inside the component class                                                                                                                                |
| C7  | CSS is compiled per-page; a component CSS change triggers re-rendering of every page that includes that component; a `global.css` change triggers re-rendering of all pages |
| C8  | Components are HTML snippets with named placeholders                                                                                                                        |

### 2.2 Proposed (philosophy-aligned extensions)

| # | Constraint | Rationale |
|---|-----------|-----------|
| C9 | **One component = one file.** File name is the component ID. No inline or anonymous components. | AI finds the right file by name, edits it, done. No hunting. |
| C10 | **Typed placeholders with strict validation.** Slots are `{{type:name}}`. `text` validates against a whitelist of safe inline formatting tags (`<strong>`, `<em>`, `<a href>`, `<code>`, `<br>`, etc.) — anything outside the whitelist is rejected with an error telling the AI exactly what to fix. `html` is raw and unsanitized — use for trusted block-level content. `image`, `link`, `list`, `bool`, and `slot` each enforce their own structure. | Reduces AI error; the engine validates and gives actionable error messages. The AI can't accidentally inject `<script>` via a `text` field — it gets an error instead. |
| C11 | **CSS class-prefixing is automatic, built on a global baseline.** A `global.css` sets default styles for all semantic elements (h1–h6, p, a, ul, etc.) so every component inherits consistent typography, colors, and spacing. Component CSS then prefixes selectors — `h1 { font-size: 2rem; }` inside `.hero` emits `.hero h1 { font-size: 2rem; }` — adding only component-specific overrides. | Semantic elements look consistent everywhere by default. Components only style what's unique. Prevents leakage and reduces redundant CSS. |
| C12 | **Page files are layout-only.** A page declares component references and their order. Zero content lives in page files. | Separates structure from content. Reordering sections never breaks content. |
| C13 | **No inline styles, no inline scripts in components.** All styling goes through the component CSS system. All behavior is external. Scripts are declared in page YAML (`scripts: [...]`); by default they are emitted at the end of `<body>` (DOM available). `head: true` moves a script to `<head>` and the engine adds `defer` unless the author set `defer` or `async`. No `<script>` or `<style>` tags may appear in component templates. | Closes escape hatches that bypass the component model. Scripts are managed at page level, not component level. |
| C14 | **Rendered output is regenerated from scratch.** The engine always wipes `build/` and regenerates from source. Source of truth is always the component templates + data files. If a page needs custom content in `build/` (e.g. a `robots.txt`), place it in `assets/` and it is copied through. | No drift between source and output. No manual edits to build/ survive a rebuild — everything flows through the engine. |
| C15 | **Strict body structure.** `body` accepts only `<header>`, `<section id="...">`, `<footer>`, page `<script>` tags, and the optional single `<div id="page">` layout container as direct children. Any other structure is a validation error. | Guarantees semantic flatness while allowing page scripts and one page-level layout wrapper. |
| C16 | **Change propagation is explicit and minimal.** Changing component C → re-render only pages that include C. Changing page P's layout → re-render only P. Changing `global.css` → re-render all pages. | Fast feedback. Deterministic scope. |
| C17 | **CLI as the AI feedback loop.** The engine is a CLI with two-tier rendering: `engine render component <name> --page <page>` for per-component copy validation, and `engine render page <name>` for full assembly validation. All render commands output to stdout; only `engine build` writes to disk. | AI validates incrementally (component by component), then holistically (full page), then commits. |
| C18 | **Stale output detection.** The engine tracks source hashes. `engine render` is a read-only command: it always renders fresh output, reports `=== STATUS: rendered`, and its `--json` `status` field is always `rendered`; the `changed` array lists tracked sources that differ from the last build. | AI knows whether it's seeing fresh or cached output. Transparency builds trust. |
| C19 | **Scaffolding over hand-creation.** `engine create component <name>` scaffolds a valid component file with the correct three-section format, empty placeholders, and empty schema. `engine create page <name>` scaffolds a page YAML. The AI fills content into pre-validated skeletons. | Reduces boilerplate errors. AI starts from a known-good template every time. |
| C20 | **Design tokens live in `global.css`.** All `--custom-property` declarations are defined in `:root` inside `global.css`. Component CSS references them via `var()`. No component declares its own tokens. | Single source of truth for colors, spacing, typography. Changing a token updates every component. |

---

## 3. Architecture Overview

### 3.1 Project Structure

```
project/
  engine.config.yaml    # Project-wide settings (see §3.2)
  global.css            # Baseline styles + design tokens for all semantic elements
  components/           # One file per component (template + scoped CSS + schema)
    hero.component.html
    features.component.html
    pricing.component.html
    footer.component.html
  pages/                # One file per page (layout-only YAML)
    index.page.yaml
    about.page.yaml
  data/                 # Slot content per page (AI-edited separately)
    index/
      hero.yaml
      features.yaml
    about/
      hero.yaml
      team.yaml
  assets/               # Static files referenced by components
    images/
      hero-bg.webp
      logo.svg
    fonts/
      inter.woff2
  build/                # Rendered output (immutable, never edited)
    index.html
    about.html
    css/
      index.css
      about.css
    assets/              # Copied from project/assets/ at build time
```

### 3.2 Engine Configuration (`engine.config.yaml`)

```yaml
# engine.config.yaml — project-wide settings

project:
  name: "acme-marketing"
  lang: "en"

paths:
  components: "components"
  pages: "pages"
  data: "data"
  assets: "assets"
  build: "build"              # single path segment (no "/" or ".."); wiped when building all pages

build:
  minify: false               # Minify HTML/CSS output
  pretty: true                # Indent HTML output (default: true for AI readability)
  assetFingerprinting: false  # Append content hash to asset filenames

validation:
  strict: false               # Treat warnings as errors
  requireAltText: true        # All <img> must have alt text
  maxHeadingLength: 120       # Warn on headings exceeding this

server:
  port: 3000                  # For `engine serve` (future)
  livereload: true
```

### 3.3 Data Flow

```
Global CSS ─────────────────────────────────────────┐
Component CSS (scoped) ──→ CSS Compiler → Page CSS ─┤
Component Template + Data  → Renderer    → Page HTML┘
```

1. AI edits `components/hero.component.html` → engine re-renders every page referencing `hero`
2. AI edits `data/index/hero.yaml` → engine re-renders only `index.html`
3. AI edits `pages/index.page.yaml` → engine re-renders only `index.html`
4. AI edits `global.css` → engine re-renders all pages

These triggers are also listed in §6.5 Change Propagation.

---

## 4. Component Specification

### 4.1 Component File Format

Each component file is a self-contained unit with three sections delimited by `---`:

```html
<!-- hero.component.html -->

<h1>{{text:heading}}</h1>
<p>{{text:subtext}}</p>
{{html:cta}}
---
/* CSS — author writes as if inside the component; engine prefixes with .hero */
h1 { font-size: 3rem; line-height: 1.1; }
p { color: var(--text-muted); }
a { display: inline-block; padding: 0.75rem 2rem; }
---
{
  "heading": { "type": "text", "required": true, "maxLength": 120 },
  "subtext": { "type": "text", "required": false, "maxLength": 300 },
  "cta": { "type": "html", "required": false }
}
```

| Section | Purpose |
|---------|---------|
| Template (HTML) | Semantic markup with `{{type:name}}` placeholders |
| CSS (optional) | Scoped styles — engine prefixes every selector with `.component-class` |
| Schema (JSON) | Placeholder definitions: types, required/optional, constraints |

### 4.2 Component Class Naming

The component class is derived from the file name: `hero.component.html` → class `hero`. This class is added to the wrapping element and is the prefix for all scoped CSS.

### 4.3 Placeholder Types

#### 4.3.1 `text` — Escaped string with safe inline formatting

**Template syntax**: `{{text:name}}`  
**Data value**: a string, optionally containing a whitelisted set of inline HTML tags  
**Rendered as**: HTML-escaped text, with whitelisted tags preserved.

**Allowed tags** (inline formatting only):

| Tag | Purpose | Allowed attributes |
|-----|---------|-------------------|
| `<strong>`, `<b>` | Bold | none |
| `<em>`, `<i>` | Italic | none |
| `<a href="...">` | Link | `href` only |
| `<code>` | Inline code | none |
| `<br>` | Line break | none (self-closing) |
| `<mark>` | Highlight | none |
| `<del>`, `<ins>` | Strikethrough, insertion | none |
| `<sub>`, `<sup>` | Subscript, superscript | none |
| `<small>` | Small text | none |

**Validation: strict rejection, not silent stripping.**

If a `text` value contains any tag or attribute outside the whitelist, the engine emits an error and refuses to render the component. The error tells the AI exactly what's wrong:

```
ERROR [data/index/hero.yaml:heading]: disallowed tag <script> in text field.
  Allowed inline tags: <strong>, <em>, <b>, <i>, <a href="...">, <code>, <br>, <mark>, <del>, <ins>, <sub>, <sup>, <small>

ERROR [data/index/hero.yaml:subtext]: disallowed attribute "onclick" on <a> in text field.
  Allowed attributes on <a>: href only.

ERROR [data/index/hero.yaml:body]: block-level tag <div> not allowed in text field.
  Use {{html:body}} for block-level content (paragraphs, headings, lists, divs).
```

The AI reads the error, fixes the offending tag, and re-runs. No silent data loss, no round-trip inspection.

```yaml
# data/index/hero.yaml
heading: "Build <strong>Faster</strong>, Ship with <em>Confidence</em>"
subtext: "The <a href=\"/docs\">deterministic HTML engine</a> for AI agents.<br>No surprises."
```

```html
<!-- component template -->
<h1>{{text:heading}}</h1>
<p>{{text:subtext}}</p>

<!-- rendered -->
<h1>Build <strong>Faster</strong>, Ship with <em>Confidence</em></h1>
<p>The <a href="/docs">deterministic HTML engine</a> for AI agents.<br>No surprises.</p>
```

**When to use `html` instead**: `text` only allows inline formatting. For block-level rich content — blog post bodies with paragraphs, headings, lists, images, blockquotes — use `{{html:name}}`. The AI is responsible for generating safe HTML (typically by converting Markdown). The engine does not sanitize `html` placeholders.

```yaml
# For a blog post body, use html:
body: "<p>First paragraph.</p><h2>Section</h2><p>More content.</p>"
```

#### 4.3.2 `html` — Raw HTML fragment

**Template syntax**: `{{html:name}}`  
**Data value**: a string containing arbitrary HTML markup  
**Rendered as**: injected as inner HTML, unescaped. Use for block-level rich content (blog posts, complex layouts) where the AI generates trusted HTML. The engine performs no sanitization — the AI is responsible for correctness.

```yaml
# data/index/hero.yaml
cta: "<a href=\"/signup\" class=\"btn\">Get Started</a>"

# data/blog/post.yaml — block-level content
body: "<p>First paragraph.</p><h2>Section</h2><p>More content with <strong>bold</strong>.</p>"
```

```html
<!-- component template -->
<div>{{html:cta}}</div>

<!-- rendered -->
<div><a href="/signup" class="btn">Get Started</a></div>
```

#### 4.3.3 `image` — Image element

**Template syntax**: `{{image:name}}`  
**Data value**: an object with `src` (required) and `alt` (required when `validation.requireAltText` is `true` in `engine.config.yaml`):

```yaml
# data/index/hero.yaml
hero_bg:
  src: "assets/images/hero-bg.webp"
  alt: "Team collaborating in a modern office"
  width: 1200    # optional
  height: 800    # optional
  loading: lazy  # optional: "lazy" | "eager" (default: "lazy")
```

```html
<!-- component template -->
{{image:hero_bg}}

<!-- rendered -->
<img src="assets/images/hero-bg.webp" alt="Team collaborating in a modern office" width="1200" height="800" loading="lazy">
```

**`image`, `link`, and `slot` emit whole elements.** They can only be used as element content — never inside an attribute value. `src="{{image:logo}}"` is a `COMPONENT_PLACEHOLDER_IN_ATTRIBUTE` error because the replacement `<img ...>` would land inside the quotes and corrupt the markup. Put the placeholder in the element body and size the box in CSS:

```html
<!-- ❌ error: element inside an attribute -->
<img src="{{image:logo}}" alt="Logo">

<!-- ✅ correct: placeholder is content, CSS owns the box -->
<span class="logo">{{image:logo}}</span>
```
```css
.logo img { height: 2rem; width: auto; }
```

#### 4.3.4 `link` — Anchor element

**Template syntax**: `{{link:name}}`  
**Data value**: an object with `href` (required) and `label` (required):

```yaml
cta_link:
  href: "/signup"
  label: "Get Started"
```

```html
<!-- component template -->
{{link:cta_link}}

<!-- rendered -->
<a href="/signup">Get Started</a>
```

#### 4.3.5 `list` — Repeated items with a sub-template

**Template syntax**: block delimiters `{{#list:name}}` ... `{{/list:name}}` with typed placeholders inside the block.  
**Data value**: an array. Each element can be:
- An **object**: fields accessed by name, e.g. `{{text:title}}`
- A **scalar** (string, number): accessed via the reserved name `this`, e.g. `{{text:this}}`

```yaml
# data/index/features.yaml — array of objects
features:
  - title: "Component Isolation"
    description: "Edit one section without touching others."
  - title: "Deterministic Builds"
    description: "Same inputs, same output, always."
```

```html
<!-- component template -->
<ul>
{{#list:features}}
  <li>
    <strong>{{text:title}}</strong>
    <p>{{text:description}}</p>
  </li>
{{/list:features}}
</ul>

<!-- rendered -->
<ul>
  <li>
    <strong>Component Isolation</strong>
    <p>Edit one section without touching others.</p>
  </li>
  <li>
    <strong>Deterministic Builds</strong>
    <p>Same inputs, same output, always.</p>
  </li>
</ul>
```

**Array of strings** (use `{{text:this}}`):

```yaml
items:
  - "First item"
  - "Second item"
```

```html
{{#list:items}}<li>{{text:this}}</li>{{/list:items}}

<!-- rendered -->
<li>First item</li><li>Second item</li>
```

**`list` vs a sequence data file.** `{{#list:name}}` iterates an array *inside one component instance*; the item fields are read as `{{text:field}}` and are **not** component schema fields. To repeat the **whole component** (one wrapper per element, ids `<name>-0`, …), make the data file a YAML sequence instead — see §4.4. A nested `"item"` schema on a `list` field is unsupported and produces `COMPONENT_PLACEHOLDER_TYPE`.

#### 4.3.6 `bool` — Conditional rendering

**Template syntax**: block delimiters `{{#bool:name}}` ... `{{/bool:name}}`  
**Data value**: `true` or `false`  
**Rendered as**: if `true`, everything between the delimiters is rendered. If `false`, the entire wrapped content is omitted from output. The delimiters are always removed.

```yaml
# data/index/hero.yaml
show_badge: true
```

```html
<!-- component template -->
{{#bool:show_badge}}
  <span class="badge">New</span>
{{/bool:show_badge}}

<!-- rendered (true) -->
<span class="badge">New</span>

<!-- rendered (false) — empty, nothing emitted -->
```

#### 4.3.7 `if` / `unless` — Field conditionals

**Template syntax**: `{{#if:name}}...{{/if:name}}` and `{{#unless:name}}...{{/unless:name}}`  
**Data value**: any type  
**Rendered as**: `if` renders its block when the value is truthy; `unless` renders when it is falsy. The delimiters are always removed.

Truthiness: `true`, a non-blank string (trimmed), a non-empty array/object, and a non-zero number are truthy. `false`, `null`/missing, `""`/whitespace, `[]`, `{}`, `0`, and `NaN` are falsy.

Unlike `list`, conditionals reuse the **component's** data scope, so placeholders inside the block are ordinary schema fields. `if`/`unless` are block guards over an existing field, not schema entry types — the field keeps its real type (`text`, `bool`, `image`, …). Example:

```yaml
# data/index/hero.yaml
show_badge: true
badge_text: "New"
```

```html
<!-- component template -->
{{#if:show_badge}}<span class="badge">{{text:badge_text}}</span>{{/if:show_badge}}
{{#unless:show_badge}}<span class="badge muted">—</span>{{/unless:show_badge}}

<!-- rendered (show_badge: true) -->
<span class="badge">New</span>
```

`if`/`unless` replace the "pass a class name through data" and "delete the schema field to silence a warning" workarounds: keep the field in the schema so data validation still applies, and guard its use in the template.

#### 4.3.8 `slot` — Nested component reference

**Template syntax**: `{{slot:name}}`  
**Data value**: an object with `component` (the component name to embed) and `data` (its placeholder values). When `data` is omitted, the nested component uses the parent page's data directory — the engine looks for `data/<page>/<nested-component>.yaml`.

**With inline data** (typical for one-off instances):

```yaml
# data/index/pricing.yaml
card_list:
  component: "pricing-card"
  data:
    plan: "Pro"
    price: "$29"
    features:
      - "Unlimited projects"
      - "Priority support"
```

```html
<!-- component template -->
<div class="pricing-grid">
  {{slot:card_list}}
</div>

<!-- rendered: the pricing-card component is rendered inline with the provided data, then wrapped in .pricing-grid -->
<div class="pricing-grid">
  <div class="pricing-card">
    <h3>Pro</h3>
    <strong>$29</strong>
    <ul>
      <li>Unlimited projects</li>
      <li>Priority support</li>
    </ul>
  </div>
</div>
```

**Constraints on `slot`**:
- The engine resolves nested component data in this order: (1) inline `data` field in the slot value, (2) `data/<page>/<nested-component>.yaml` if it exists, (3) schema defaults. Inline data takes priority.
- Nested components inherit the parent page's context (same CSS, same asset paths)
- Nesting depth is limited to 3 levels (circular reference detected at build time)
- A nested component's CSS is included in the page's compiled CSS
- A component cannot reference itself directly or indirectly

#### 4.3.9 Placeholder Type Summary

| Type | Template syntax | Data shape | Output |
|------|----------------|------------|--------|
| `text` | `{{text:name}}` | `string` (inline formatting allowed per whitelist) | Sanitized HTML with inline tags |
| `html` | `{{html:name}}` | `string` | Raw HTML |
| `image` | `{{image:name}}` | `{src, alt, width?, height?, loading?, class?}` | `<img>` element (content only) |
| `link` | `{{link:name}}` | `{href, label, class?}` | `<a>` element (content only) |
| `list` | `{{#list:name}}...{{/list:name}}` | `array` | Repeated block inside one instance |
| `bool` | `{{#bool:name}}...{{/bool:name}}` | `boolean` | Renders only when exactly `true` |
| `if` | `{{#if:name}}...{{/if:name}}` | `any` | Renders when truthy |
| `unless` | `{{#unless:name}}...{{/unless:name}}` | `any` | Renders when falsy |
| `slot` | `{{slot:name}}` | `{component, data?}` | Nested component (content only) |

### 4.4 Data File Format

A data file is a YAML (or JSON) file whose top-level keys match placeholder names in the component's template. The structure of each value depends on the placeholder type.

**File naming**: `data/<page-name>/<component-name>.yaml`

**Map vs sequence** — the top-level shape decides what repeats:

| Top-level YAML | Meaning |
|----------------|---------|
| **Map** (one instance) | One component instance; keys are the schema fields. |
| **Sequence** (repeat the component) | One instance per element, rendered once each with ids `<name>-0`, `<name>-1`, … (a single-element sequence also gets `-0`). Each element is a map of the **same flat schema fields**; the page lists the component once. |
| **`list` field inside a map** | A block inside one instance, iterated by `{{#list:name}}`. Item fields are read as `{{text:field}}` and are **not** component schema fields. |

A nested item schema (`"items": {"type": "list", "item": {"title": {...}}}`) is unsupported and fails with `COMPONENT_PLACEHOLDER_TYPE`; flatten the schema for component repetition, or read list item fields with `{{text:field}}`.

```yaml
# data/index/hero.yaml — data for the hero component on the index page

# text placeholder (with inline formatting)
heading: "Build <strong>Faster</strong>, Ship with <em>Confidence</em>"

# text placeholder (optional per schema)
subtext: "The deterministic HTML engine for AI agents."

# html placeholder
cta: "<a href=\"/signup\" class=\"btn-primary\">Get Started</a>"

# image placeholder
hero_image:
  src: "assets/images/hero.webp"
  alt: "Abstract illustration of fast development"
  loading: eager

# bool placeholder
show_badge: true

# list placeholder (array of objects)
features:
  - title: "Component Isolation"
  - title: "Deterministic Output"
```

**Validation rule**: every key in the data file must match a placeholder in the component's schema. Unknown keys produce a `WARNING`. Missing required keys produce an `ERROR` and the component/page will not render. In a sequence data file, schema errors name the failing element: `element [2] /body must be string`. A `data/<page>/<component>.yaml` whose component the page no longer lists produces a `DATA_FILE_ORPHAN` warning.

### 4.5 Component Rendering Rules

1. Template is parsed for `{{type:name}}` placeholders and `{{#type:name}}...{{/type:name}}` block placeholders
2. Data file provides values keyed by `name`
3. Values are validated against the schema
4. `text` values are validated against the inline tag whitelist — disallowed tags/attributes produce an ERROR with specific guidance
5. `image` placeholders emit an `<img>` element with the provided attributes
6. `link` placeholders emit an `<a>` element with `href` and text content
7. `list` blocks iterate over the array; each iteration renders the block content with that item's fields in scope
8. `bool` blocks render their content only if the value is `true`
9. `if`/`unless` blocks reuse the component's data scope and render on truthiness/falsiness
10. `slot` placeholders recursively render the referenced component with the provided data
11. `image`, `link`, and `slot` placeholders emit whole elements; using one inside an attribute value → `COMPONENT_PLACEHOLDER_IN_ATTRIBUTE`
12. Missing required values → build error (page not rendered)
13. Unused data keys → warning (AI may have a stale data file)
14. Block delimiters (`{{#...}}`, `{{/...}}`) are removed from output regardless of rendering

---

## 5. Page Specification

### 5.1 Page File Format

A page file is a minimal declaration of component order:

```yaml
# index.page.yaml
title: "Home — Acme Inc."
description: "Landing page for Acme"
lang: "en"                         # Overrides engine.config.yaml if set
favicon: "assets/images/favicon.svg"
viewport: "width=device-width, initial-scale=1"
layout:                             # Optional page-level layout (issue 09/10)
  bodyClass: "dark print"           # appended after the page name on <body>
  wrapper: true                     # wrap all component wrappers in <div id="page" class="page">
head:                               # Additional <head> content (optional)
  meta:
    - name: "og:title"
      content: "Acme Inc. — Build Faster"
    - name: "og:description"
      content: "The deterministic HTML engine for AI agents."
    - name: "og:image"
      content: "assets/images/og-image.webp"
  link:
    - rel: "canonical"
      href: "https://acme.com/"
scripts:                            # External scripts (optional)
  - src: "assets/js/main.js"        # default: end of <body>, DOM available
    defer: true
  - src: "assets/js/analytics.js"
    head: true                      # → <head>, with defer added automatically
components:
  - hero
  - features
  - pricing
  - cta
  - footer
```

**Body identity**: the engine always emits `<body class="<page>" data-page="<page>">`. `layout.bodyClass` appends extra classes after the page name, so `body.index { … }` (or `body.<page> …`) scopes CSS to one page without a post-build script.

### 5.2 Assembly Rules

The wrapper tag is derived from the component **name**, never its position in the page (C3, C4, C5):

| Component name | Wrapper |
|----------------|---------|
| `header` | `<header id="header" class="header">` |
| `footer` | `<footer id="footer" class="footer">` |
| anything else | `<section id="<name>" class="<name>">` |

1. Components are rendered in declared order and each gets exactly one wrapper carrying `id` and `class` = the component name
2. A component named `header` is wrapped in `<header id="header" class="header">`
3. A component named `footer` is wrapped in `<footer id="footer" class="footer">`
4. If no component named `footer` exists, the engine appends a built-in default footer **after** the last component:
   ```html
   <footer id="footer" class="footer">
     <p>&copy; 2026 Acme Inc.</p>
   </footer>
   ```
   The year is the current year. The project name comes from `engine.config.yaml`.
5. Every other component is wrapped in `<section id="<name>" class="<name>">`
6. The component's rendered inner HTML is placed inside its wrapper
7. A sequence data file renders one wrapper per element, with `id="<name>-<index>"` (`-0`, `-1`, …); the `class` stays the plain component name
8. The assembled body is `<body class="<page> [bodyClass]" data-page="<page>">`
9. With `layout.wrapper: true`, all component wrappers are enclosed in `<div id="page" class="page">`
10. Page scripts without `head` are emitted at the end of `<body>`; `head: true` scripts go to `<head>` with `defer` added unless `defer`/`async` is set

---

## 6. CSS System

### 6.1 Design Tokens & Global Baseline (`global.css`)

The global stylesheet serves two purposes: (1) declare all CSS custom properties (design tokens) in `:root`, and (2) set baseline styles for every semantic element using those tokens.

```css
/* global.css — design tokens + baseline for all semantic elements */

/* ── Design Tokens ───────────────────────────────────── */
:root {
  /* Colors */
  --color-primary: #0066cc;
  --color-primary-hover: #0052a3;
  --color-text: #1a1a1a;
  --color-text-muted: #555;
  --color-bg: #ffffff;
  --color-bg-alt: #f5f5f5;
  --color-border: #e0e0e0;

  /* Typography */
  --font-family: system-ui, -apple-system, sans-serif;
  --font-size-base: 1rem;
  --font-size-h1: 2.5rem;
  --font-size-h2: 2rem;
  --font-size-h3: 1.5rem;
  --font-size-h4: 1.25rem;
  --font-size-sm: 0.875rem;
  --line-height: 1.6;
  --line-height-heading: 1.2;

  /* Spacing */
  --space-xs: 0.25rem;
  --space-sm: 0.5rem;
  --space-md: 1rem;
  --space-lg: 2rem;
  --space-xl: 4rem;

  /* Borders */
  --radius-sm: 4px;
  --radius-md: 8px;
}

/* ── Reset ───────────────────────────────────────────── */
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; font-family: var(--font-family); font-size: var(--font-size-base); color: var(--color-text); background: var(--color-bg); }

/* ── Semantic Element Baseline ───────────────────────── */
h1 { font-size: var(--font-size-h1); font-weight: 700; line-height: var(--line-height-heading); margin-bottom: var(--space-md); }
h2 { font-size: var(--font-size-h2); font-weight: 600; line-height: var(--line-height-heading); margin-bottom: var(--space-md); }
h3 { font-size: var(--font-size-h3); font-weight: 600; line-height: var(--line-height-heading); margin-bottom: var(--space-sm); }
h4 { font-size: var(--font-size-h4); font-weight: 500; line-height: var(--line-height-heading); }
p  { line-height: var(--line-height); margin-bottom: var(--space-md); color: var(--color-text); }
a  { color: var(--color-primary); text-decoration: none; }
a:hover { color: var(--color-primary-hover); text-decoration: underline; }
ul, ol { padding-left: 1.5rem; margin-bottom: var(--space-md); }
li { margin-bottom: var(--space-sm); }
blockquote { border-left: 3px solid var(--color-border); padding-left: var(--space-md); color: var(--color-text-muted); }
```

**C20**: All custom properties live in `:root` in `global.css`. Component CSS references tokens via `var()`. No component declares its own `--custom-property`. This ensures changing a token updates every component consistently.

**Rule**: A component must never redefine something `global.css` already sets correctly. If an `<h1>` inside `.hero` needs to be larger, the component CSS adds `font-size: 3rem` — it doesn't re-declare `font-weight`, `line-height`, or `margin` unless it intentionally overrides them.

### 6.2 Component CSS Scoping (C11)

For each component `C` with class `c` and CSS block `B`:

```
For every rule in B:
  For each selector in the comma-separated selector list:
    If the selector starts with :global(...), emit it unscoped with :global(...) unwrapped
    Else if the selector's first compound starts with html, body, :root, or :host, emit it unchanged
    Else if the selector is already prefixed with .c, leave it unchanged
    Else, prepend ".c " to the selector
  Rejoin with ", "

Example:
  Input:  h1 { font-size: 3rem; }  .special { text-transform: uppercase; }
  Output: .hero h1 { font-size: 3rem; }  .hero .special { text-transform: uppercase; }

  Input:  h1, h2, h3 { margin: 0; }
  Output: .hero h1, .hero h2, .hero h3 { margin: 0; }
```

**Scoping escape hatch (issue 07).** A `.c ` prefix could never match a document-root selector, so those are emitted unscoped; `:global(...)` opts a whole selector out:

```css
/* component CSS input                     → assembled output */
body { display: flex; }                    /* → body { display: flex; } */
:global(.leaflet-container) { z-index: 1; }/* → .leaflet-container { z-index: 1; } */
@page { size: 1280px 720px; margin: 0; }   /* → passed through verbatim */
```

`@page` (like `@keyframes` and `@font-face`) is a passthrough at-rule and is never scoped. Selectors inside `@media`/`@supports` follow the same rules.

### 6.3 Per-Page CSS Assembly

1. Include `global.css` as the first layer
2. Identify all components referenced by page P
3. Collect their scoped CSS blocks
4. Concatenate: global → component styles, deduplicate identical rules
5. Output as a single `css/{page-name}.css` file
6. The page HTML includes one `<link>` to its compiled CSS

**Cascade order**: global baseline → component overrides. Component styles always win over global defaults for the same property.

### 6.4 CSS Deduplication

During per-page assembly, the engine normalizes CSS (strips insignificant whitespace, standardizes semicolons) then deduplicates rules where the full selector AND all declarations are byte-for-byte identical.

```
Component A: .hero .btn { padding: 0.75rem 2rem; }
Component B: .cta .btn { padding: 0.75rem 2rem; }  → Kept (different selector)

Component A: .card { border-radius: 8px; }
Component B: .card { border-radius: 8px; }           → Merged (identical selector + declarations)
```

**Design rationale**: only exact duplicates are merged. Semantic equivalence (same declarations, different selectors) is NOT merged because specificity order matters and automated merging could change cascade behavior.

### 6.5 Change Propagation

| What changed | What gets re-rendered |
|-------------|----------------------|
| Component template | All pages referencing that component |
| Component CSS | All pages referencing that component |
| Component schema | All pages referencing that component |
| Data file | Only the page that data file belongs to |
| Page layout | Only that page |
| Global/shared CSS | All pages |

---

## 7. Output Format

### 7.1 Rendered Page Structure

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Home — Acme Inc.</title>
  <meta name="description" content="Landing page for Acme">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" href="assets/images/favicon.svg">
  <meta name="og:title" content="Acme Inc. — Build Faster">
  <meta name="og:description" content="The deterministic HTML engine for AI agents.">
  <meta name="og:image" content="assets/images/og-image.webp">
  <link rel="canonical" href="https://acme.com/">
  <link rel="stylesheet" href="css/index.css">
</head>
<body class="index" data-page="index">
  <!-- "hero" is a regular component, so it is a <section>. A component named "header" would render as <header id="header" class="header">. -->
  <section id="hero" class="hero">
    <h1>Build Faster</h1>
    <p>Ship with confidence.</p>
    <a href="/signup">Get Started</a>
  </section>

  <section id="features" class="features">
    <h2>Features</h2>
    <ul>
      <li>Component isolation</li>
      <li>Deterministic builds</li>
    </ul>
  </section>

  <section id="pricing" class="pricing">
    <!-- ... -->
  </section>

  <section id="cta" class="cta">
    <!-- ... -->
  </section>

  <footer id="footer" class="footer">
    <p>&copy; 2026 Acme Inc.</p>
  </footer>
</body>
</html>
```

### 7.2 Structural Guarantees

- Wrapper roles are name-based: `header` → `<header>`, `footer` → `<footer>`, every other component → `<section id class>`; position in the page never changes the tag
- `body` direct children are only: `<header>`, `<section id="...">` × N, `<footer>`, page `<script>` tags, and at most one `<div id="page">` layout wrapper
- `<body>` always carries `class="<page> [bodyClass]"` and `data-page="<page>"`
- Every `<section>` has both `id` and `class` matching the component name; sequence-data elements use `id="<name>-<index>"` and class `<name>`
- No inline `style` attributes
- No `<script>` or `<style>` tags originate from component templates; scripts only appear if declared in page YAML
- All CSS is external, one file per page

---

## 7.3 Assets

Static files (images, fonts, favicons, downloadable PDFs) live in `assets/`. At build time, the engine copies the entire `assets/` tree into `build/assets/`.

### Asset referencing

Components reference assets using the path `assets/...` exactly as they appear in the project:

```yaml
# data/index/hero.yaml
hero_image:
  src: "assets/images/hero.webp"
  alt: "Hero image"
```

At render time, asset paths are preserved as-is. The browser resolves them relative to the page. No path rewriting is needed because the directory structure under `build/` mirrors the project.

### Supported asset types

The engine copies all files from `assets/` without processing. Validation checks:
- Referenced images exist in `assets/` (warning if missing)
- Image `alt` text is present (error if `requireAltText: true` in config)

---

## 7.4 `<head>` Extensibility

The `<head>` of each page is assembled from:

1. **Engine defaults**: `<meta charset="UTF-8">`
2. **Page YAML fields**: `title` → `<title>`, `description` → `<meta name="description">`, `lang` → `<html lang>`, `favicon` → `<link rel="icon">`, `viewport` → `<meta name="viewport">`
3. **Page YAML `head` block**: arbitrary `<meta>` and `<link>` tags for Open Graph, Twitter Cards, canonical URLs, preloads, etc.
4. **Page YAML `scripts`**: each entry emits a `<script>` tag. `src` is required. Optional: `defer` (boolean), `async` (boolean), `type` (string, default `"text/javascript"`), `head` (boolean). Scripts are emitted at the end of `<body>` by default so the DOM exists when they run; `head: true` moves the script to `<head>` and the engine adds `defer` unless `defer` or `async` was set explicitly.
5. **Compiled CSS link**: `<link rel="stylesheet" href="css/{page}.css">`

```yaml
# scripts emit as:
scripts:
  - src: "assets/js/main.js"
    defer: true
# → <script src="assets/js/main.js" defer></script> at end of <body>

  - src: "assets/js/analytics.js"
    head: true
# → <script src="assets/js/analytics.js" defer></script> in <head> (defer added automatically)
```

No `<script>` or `<style>` tags are permitted inside component templates (C13). All scripts flow through the page YAML; all styles flow through `global.css` + component CSS blocks. The engine validates that component templates contain neither tag.

---

## 7.5 Print and Fixed-Canvas Output

`vh`/`vw` are **not print-safe**: Chromium resolves them against the print viewport, so a fixed-size slide reflows on paper. For print/PDF output:

1. Set `layout.wrapper: true` and give the `<div id="page">` container fixed `px` dimensions.
2. Add `@page { size: 1280px 720px; margin: 0 }` to `global.css` (the `@page` at-rule passes through component CSS and global CSS unchanged).

A built-in `--pdf` export is deliberately **not** implemented: it would require adding a headless-browser dependency to the engine.

The repository's `examples/deck/` project is the known-good reference: two fixed 1280×720 slides using `layout.wrapper: true`, `layout.bodyClass: "deck"`, a body-end `assets/deck-nav.js` page script, `head.meta` with `deck-total`, and `@page { size: 1280px 720px; margin: 0 }` in `global.css`. It is covered by `test/examples.test.ts` and validates clean.

---

## 8. CLI Design

The engine is a CLI tool with a two-tier rendering model: **component render** for per-component validation during editing, and **page render** for final assembly validation. All commands output to stdout; `build` is the only command that writes to disk.

### 8.1 Command Reference

```bash
# ── Project Initialization ───────────────────────────────

# Initialize a new project in the current directory.
# Creates: engine.config.yaml, global.css, components/, pages/, data/, assets/
engine init
engine init --name "my-project"     # Set project name in config

# ── Scaffolding ──────────────────────────────────────────

# Scaffold a new component with correct three-section format.
# Creates: components/<name>.component.html with empty template, empty CSS, empty schema.
engine create component <name>
# e.g. engine create component testimonials

# Scaffold a new page.
# Creates: pages/<name>.page.yaml with empty component list.
engine create page <name>
# e.g. engine create page pricing

# Scaffold a data file for a component on a specific page.
# Creates: data/<page>/<component>.yaml with all placeholder keys from schema, values empty.
engine create data <component> --page <page>
# e.g. engine create data hero --page about

# ── Component-level (tight feedback loop) ──────────────────────

# Render ONE component with a specific page's data to stdout.
# Output: the component's inner HTML with placeholders resolved.
# Use this after editing a data file to validate the copy/content.
engine render component <name> --page <page>
# e.g. engine render component hero --page index

# Render a component with all pages' data.
# Output: each page's rendering separated by "=== PAGE: <name> ===" dividers.
engine render component <name> --all

# Preview a component with auto-generated sample data.
# Sample data is derived from the schema: text → "Sample <name>", bool → true,
# image → placeholder with "Sample alt text", list → one sample item.
engine preview component <name>

# ── Page-level (final assembly validation) ─────────────────────

# Render the full assembled HTML page to stdout.
# Use this when all component content is done — validates layout,
# section order, and CSS assembly.
engine render page <name>
# e.g. engine render page index
engine render page <name> --compact    # HTML only, no annotation header

# ── Validation ─────────────────────────────────────────────────

# Validate all components, pages, and data (exit code 1 on errors)
engine validate
engine validate page <name>            # Validate one page
engine validate component <name>       # Validate one component's schema + template

# ── Diff ────────────────────────────────────────────────────────

# Show what changed between current source and last build.
# Output: unified diff of the rendered HTML. Useful for AI pre-build review.
engine diff
engine diff page <name>                # Diff one page

# ── Page Composition ────────────────────────────────────────────

# Add a component to a page's component list (avoids manual YAML editing)
engine add component <name> --page <page>
# e.g. engine add component testimonials --page index

# ── Build (write to disk) ──────────────────────────────────────

# Build all pages to the build/ directory
engine build
engine build page <name>               # Build one page

# ── Utility ────────────────────────────────────────────────────

# Watch mode: rebuild on file changes, show diff to stdout
engine watch

# List resources
engine list pages
engine list components
engine list data <page-name>
```

`engine list pages`, `engine context`, and build-all enumerate page names in **natural sort order**: `slide-1`, `slide-2`, `slide-10` (digit chunks compare numerically, text chunks by code unit).

### 8.2 Two-Tier Rendering Philosophy

```
┌─ COMPONENT TIER (per-component, iterative) ────────────────────────┐
│                                                                    │
│  AI edits data/index/hero.yaml                                     │
│       ↓                                                            │
│  AI runs: engine render component hero --page index                │
│       ↓                                                            │
│  stdout:                                                           │
│    === COMPONENT: hero                                             │
│    === PAGE: index                                                 │
│    === STATUS: rendered (changed: data/index/hero.yaml)            │
│                                                                    │
│    <h1>Welcome to Acme</h1>                                        │
│    <p>Ship with confidence.</p>                                    │
│    <a href="/signup">Get Started</a>                               │
│       ↓                                                            │
│  AI inspects: heading correct? subtext reads well? CTA link ok?    │
│       │                                                            │
│     Yes ──→ move to next component                                 │
│      No ──→ fix data/index/hero.yaml ──→ re-run component render   │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘

┌─ PAGE TIER (full assembly, once all components are done) ──────────┐
│                                                                    │
│  AI runs: engine render page index                                 │
│       ↓                                                            │
│  stdout:                                                           │
│    === PAGE: index                                                 │
│    === STATUS: rendered (changed: data/index/hero.yaml, data/...)  │
│    === COMPONENTS: hero, features, pricing, cta, footer            │
│    === CSS: css/index.css (global + 5 components)                  │
│                                                                    │
│    <!DOCTYPE html>                                                 │
│    <html lang="en">                                                │
│    ...full assembled page...                                       │
│    </html>                                                         │
│       ↓                                                            │
│  AI inspects: section order right? IDs present? footer in place?   │
│       │                                                            │
│     Yes ──→ engine build                                           │
│      No ──→ fix layout/data ──→ re-run page render ──→ build      │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

**Key rule**: component render = tight loop for copy/content editing. Page render = final gate before build. AI validates incrementally, component by component, then holistically.

### 8.3 Component Render Output

When rendering a single component, the engine outputs the **inner HTML only** — no wrapping `<section>`, no `<header>`, no page shell. This is the component's template with placeholders resolved against the page's data file:

```
=== COMPONENT: hero
=== PAGE: index
=== STATUS: rendered (changed: data/index/hero.yaml)

<h1>Welcome to Acme</h1>
<p>Ship with confidence.</p>
<a href="/signup">Get Started</a>
```

If the data file has an error:

```
=== COMPONENT: hero
=== PAGE: index
=== STATUS: error

ERROR [data/index/hero.yaml]: missing required field "heading" (schema: components/hero.component.html)
```

No HTML is emitted on error. The AI fixes the data file and re-runs.

### 8.4 Page Render Output

When rendering a full page, the engine outputs the complete assembled HTML document with annotation header:

```
=== PAGE: index
=== STATUS: rendered (changed: data/index/hero.yaml, data/index/features.yaml)
=== COMPONENTS: hero, features, pricing, cta, footer
=== CSS: css/index.css (global + 5 components)

<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Home — Acme Inc.</title>
  <meta name="description" content="Landing page for Acme">
  <link rel="stylesheet" href="css/index.css">
</head>
<body class="index" data-page="index">
  <section id="hero" class="hero">
    <h1>Welcome to Acme</h1>
    ...
  </section>
  ...
</body>
</html>
```

Read-only `render` commands always print `=== STATUS: rendered` because they always produce fresh output, and the `--json` `status` field is `rendered` too. Use the `changed` array to see whether tracked sources differ from the last build:

```json
{ "ok": true, "page": "index", "status": "rendered", "changed": [], "html": "<!DOCTYPE html>…" }
```

### 8.5 Error Output

Validation errors are printed to stderr in a structured format:

```
ERROR [data/index/hero.yaml]: missing required field "heading" (schema: components/hero.component.html)
WARNING [data/index/features.yaml]: unused key "old_description" (not in schema)
ERROR [pages/index.page.yaml]: component "testimonials" not found in components/
```

The AI reads these, fixes the input files, and re-runs the appropriate render command.

## 9. AI Agent Workflow

### 9.1 Step-by-Step Editing Session

**Adding copy to a new page:**

```
1. AI runs: engine create page about
2. AI edits pages/about.page.yaml (declares components: hero, team, footer)
3. AI runs: engine create data hero --page about
4. AI edits data/about/hero.yaml (fills heading, subtext, cta)
5. AI runs: engine render component hero --page about
6. AI inspects stdout — heading reads well, subtext fits, CTA correct
7. If issue → fix data/about/hero.yaml → re-run step 5
8. AI repeats steps 3-7 for team component
9. AI runs: engine render page about
10. AI inspects full assembly — sections in order, IDs present, footer correct
11. AI runs: engine build
```

**Creating a new component:**

```
1. AI runs: engine create component testimonials
2. AI edits components/testimonials.component.html (adds template, CSS, schema)
3. AI runs: engine add component testimonials --page index
4. AI runs: engine create data testimonials --page index
5. AI edits data/index/testimonials.yaml (fills content)
6. AI runs: engine render component testimonials --page index
7. AI validates, then: engine render page index → engine build
```

**Changing copy on an existing page:**

```
1. AI edits data/index/hero.yaml (changes heading to "Welcome to Acme")
2. AI runs: engine render component hero --page index
3. AI inspects stdout — confirms new heading, nothing else changed
4. AI runs: engine render page index
5. AI inspects full page — heading updated, everything else intact
6. AI runs: engine build
```

**Style change (global):**

```
1. AI edits global.css (changes h1 font-size)
2. AI runs: engine render page index
3. AI inspects full page — all h1s larger, component overrides still cascade correctly
4. AI runs: engine build
```

**Style change (component-specific):**

```
1. AI edits components/hero.component.html CSS block
2. AI runs: engine render page index
3. AI inspects full page — only hero h1 affected
4. AI runs: engine build
```

**Layout change:**

```
1. AI edits pages/index.page.yaml (reorders components)
2. AI runs: engine render page index
3. AI inspects full page — sections in new order, IDs intact
4. AI runs: engine build
```

### 9.2 Safety Properties

- Editing a data file **cannot** break HTML structure
- Editing a component CSS **cannot** leak into other components
- Editing a component template **cannot** affect another component's markup
- Adding a new component **cannot** break existing pages (they don't reference it)
- Reordering components in a page **cannot** break component internals

---

## 10. Validation Rules

### 10.1 Build-Time Checks

| Check | Error if |
|-------|---------|
| Component file parse | Template/CSS/Schema sections malformed |
| Forbidden tags | Component template contains `<script>`, `<style>`, or inline `style="..."` attributes |
| Text field tag validation | `text` value contains a tag not on the inline whitelist, or an attribute not allowed on a whitelisted tag |
| Placeholder resolution | `{{type:name}}` has no matching schema entry |
| Schema validation | Required field missing, type mismatch, constraint violation |
| Body structure | Direct child of `<body>` other than `header`/`section`/`footer`, a page `<script>`, or the single `<div id="page">` layout wrapper (`PAGE_BODY_CHILD`) |
| Section identity | `<section>` missing `id` or `class` |
| Element placeholder in attribute | `{{image:...}}`, `{{link:...}}`, or `{{slot:...}}` used inside an attribute value (`COMPONENT_PLACEHOLDER_IN_ATTRIBUTE`) |
| CSS leakage | Component CSS selectors resolved against only that component's template DOM — any selector matching no element in the template is reported as potentially leaking (best-effort warning; requires CSS parsing + static DOM simulation) |
| Duplicate IDs | Two sections with the same `id` in one page |
| Orphan data | Data file with no matching component in the page (`DATA_FILE_ORPHAN`, warning) |
| Array data element | Schema error inside one element of a sequence data file — the message names it, e.g. `element [2] /body must be string` |
| Duplicate diagnostics | Exact duplicate errors/warnings are collapsed before reporting, so one problem is reported once |

### 10.2 Runtime Invariants (in rendered output)

- `document.querySelectorAll('body>*')` returns only `header`, `section`, `footer`, page `script` tags, and at most one `div#page` layout wrapper
- Every `section[id]` has exactly one matching component class; sequence-data elements use `id="<name>-<index>"`
- No two elements share the same `id`
- CSS file contains only prefixed selectors matching components on the page, except root selectors (`html`/`body`/`:root`/`:host`), `:global(...)` opt-outs, and `@page` passthrough
- `<script>` tags are only present if declared in page YAML; they appear at end of `<body>` (or in `<head>` with `defer` when `head: true`)
- No `<style>` tags or inline `style="..."` attributes exist anywhere in the output

---

## 11. Open Questions & Future Directions

1. **Nested components** (`slot` type): How deep can nesting go in practice? Performance implications?
2. **Responsive breakpoints**: Component-level media queries or page-level breakpoint config?
3. **Component variants**: Same component with different CSS themes (e.g. `hero--dark`, `hero--light`) — variant key in page YAML or data file?
4. **`<nav>` element support**: Semantic nav components that render as `<nav>` instead of `<section>`. Currently all middle components are `<section>`.
5. **Multi-page data sharing**: Can `data/shared/` feed common content (nav items, site name) across pages without per-page duplication?
6. **Incremental builds in watch mode**: File watcher that rebuilds only changed pages/components.
7. **HTML-aware diff**: `engine diff` currently outputs unified diff; could produce structure-aware diffs that highlight content changes while ignoring whitespace-only reflows.
8. **`engine serve`**: Built-in dev server with livereload for browser preview alongside stdout.
9. **Internationalization (i18n)**: Multiple language versions of data files (`data/index/hero.en.yaml`, `data/index/hero.fr.yaml`).
10. **`markdown` placeholder type**: A type that accepts Markdown, converts it to safe HTML with the same tag whitelist as `text` plus block-level elements (`<p>`, `<h2>`–`<h6>`, `<ul>`, `<ol>`, `<blockquote>`, `<img>`). Would replace the `html` type for blog content — safer because the engine controls the conversion.

---

## 12. Glossary

| Term | Definition |
|------|-----------|
| **Component** | A reusable, self-contained HTML snippet with scoped CSS and typed placeholders |
| **Page** | An ordered assembly of components; no content of its own |
| **Slot / Placeholder** | A `{{type:name}}` marker in a component template that receives data at render time |
| **Block placeholder** | A `{{#type:name}}...{{/type:name}}` pair used for `list` iteration, `bool`, and `if`/`unless` conditionals |
| **Field conditional** | `{{#if:name}}`/`{{#unless:name}}` — renders a block from the component's own data scope based on truthiness |
| **Data file** | YAML/JSON providing values for a component's placeholders on a specific page; a map is one instance, a sequence repeats the whole component |
| **Scoped CSS** | Component styles automatically prefixed with the component class |
| **Design tokens** | CSS custom properties (`--color-primary`, etc.) declared in `:root` in `global.css` |
| **Build** | The deterministic process of assembling pages from component templates and data files |
| **Propagation** | The rule determining which pages must re-render when a source file changes |
| **Hero section** | Conventionally the first component on a page. It renders as `<section id="hero" class="hero">` unless it is named `header` (wrapper roles are name-based, never positional). |
| **Page identity** | The `<body class="<page>" data-page="<page>">` attributes; `layout.bodyClass` appends extra classes so CSS can target one page. |
| **Layout wrapper** | The optional `<div id="page" class="page">` emitted when page YAML sets `layout.wrapper: true`; owns flex/grid layout or a fixed print canvas. |
| **Annotation header** | The `=== PAGE:` / `=== STATUS:` block prepended by `engine render` to tell the AI what was rendered and why. |
| **Sample data** | Auto-generated placeholder values used by `engine preview`; derived from schema types (text → descriptive string, bool → true, list → one item, image → placeholder object). |
