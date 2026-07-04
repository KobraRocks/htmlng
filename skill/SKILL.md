---
name: html-engine
description: >
  REQUIRED for building and editing static HTML pages via the component-based HTML engine CLI.
  Use when the user asks to create, edit, or render web pages, landing pages, marketing sites,
  or any HTML output where deterministic component isolation is needed. The engine assembles
  pages from isolated components with scoped CSS — AI agents edit only component templates
  and data files, never raw HTML. Triggers: html engine, render page, create component,
  edit page, build html, scaffold page, component template, placeholder data, engine render,
  engine build, engine validate, engine create.
---

# HTML Engine Skill

Deterministic component-based HTML page generator. AI agents edit component templates and data files; the engine assembles pages with zero risk of collateral damage to other components.

## Project location

The engine source is at `~/Pi/projects/html-engine/`. Run it with:

```bash
npx tsx ~/Pi/projects/html-engine/src/index.ts <command>
```

All commands operate on the **current working directory**, which must contain an `engine.config.yaml` (created by `engine init`).

## Commands

### Project setup

```bash
engine init [--name <name>]           # Initialize a new project
```

### Scaffolding

```bash
engine create component <name>        # Scaffold a new component
engine create page <name>             # Scaffold a new page
engine create data <c> --page <p>     # Scaffold a data file (reads schema, fills keys)
```

### Rendering (stdout)

```bash
engine render component <c> --page <p>  # Render one component's inner HTML
engine render component <c> --all       # Render component across all pages
engine render page <p> [--compact]      # Render full HTML page
engine preview component <c>            # Preview with sample data
```

### Validation

```bash
engine validate                        # Validate all pages
engine validate page <p>              # Validate one page
engine validate component <c>         # Validate one component
```

### Build & Diff

```bash
engine build [page <p>]               # Write pages to build/ directory
engine diff [page <p>]                # Show unified diff vs last build
```

### Utility

```bash
engine add component <c> --page <p>    # Add component to page
engine list pages|components|data [<p>] # List resources
engine watch                           # Watch files and rebuild on change
```

## Workflow for AI agents

### Editing copy/content on an existing page

```
1. Edit data/<page>/<component>.yaml (change heading, subtext, etc.)
2. engine render component <component> --page <page>
3. Inspect stdout — confirm the changed content looks correct
4. If wrong → fix the YAML → re-run step 2
5. engine render page <page>          (validate full assembly)
6. engine build                        (write to disk)
```

### Creating a new page

```
1. engine create page <name>
2. Edit pages/<name>.page.yaml (set title, description, components list)
3. For each component:
   a. engine create data <component> --page <name>
   b. Edit data/<name>/<component>.yaml (fill content)
   c. engine render component <component> --page <name> (validate)
4. engine render page <name>           (validate full assembly)
5. engine build                        (write to disk)
```

### Creating a new component

```
1. engine create component <name>
2. Edit components/<name>.component.html:
   - Template: HTML with {{text:field}}, {{#list:items}}...{{/list:items}}, etc.
   - CSS (after first ---): scoped styles (engine prefixes with .<name>)
   - Schema (after second ---): JSON with placeholder definitions
3. engine add component <name> --page <page>
4. engine create data <name> --page <page>
5. Edit data/<page>/<name>.yaml
6. engine render component <name> --page <page>
7. engine render page <page>
8. engine build
```

### Changing global styles

```
1. Edit global.css (design tokens or semantic element baselines)
2. engine render page <page>           (validate cascade)
3. engine build                        (rebuild all pages)
```

## Placeholder types

| Type | Template syntax | Data shape | Notes |
|------|----------------|------------|-------|
| `text` | `{{text:name}}` | `string` | Allows inline tags: `<strong>`, `<em>`, `<a href>`, `<code>`, `<br>`, etc. Other tags rejected. |
| `html` | `{{html:name}}` | `string` | Raw HTML, unsanitized. Use for blog posts, complex markup. |
| `image` | `{{image:name}}` | `{src, alt, width?, height?, loading?}` | Emits `<img>` element |
| `link` | `{{link:name}}` | `{href, label}` | Emits `<a>` element |
| `list` | `{{#list:name}}...{{/list:name}}` | `array` | Iterates array. Objects → `{{text:field}}`. Scalars → `{{text:this}}`. |
| `bool` | `{{#bool:name}}...{{/bool:name}}` | `boolean` | Renders block only if true |
| `slot` | `{{slot:name}}` | `{component, data?}` | Embeds another component inline |

## Text field HTML whitelist

`text` fields allow these inline tags (everything else is rejected with an error):

`<strong>`, `<b>`, `<em>`, `<i>`, `<a href="...">`, `<code>`, `<br>`, `<mark>`, `<del>`, `<ins>`, `<sub>`, `<sup>`, `<small>`

Only `href` is allowed on `<a>`. No other attributes on any tag. Block-level tags (`<div>`, `<p>`, `<h1>`, etc.) produce an error suggesting to use `{{html:field}}` instead.

## Project structure

```
project/
  engine.config.yaml    # Project settings
  global.css            # Design tokens + semantic element baseline styles
  components/           # *.component.html files (template | CSS | schema)
  pages/                # *.page.yaml files (title, components list, head, scripts)
  data/                 # <page>/<component>.yaml files (placeholder values)
  assets/               # Static files (images, fonts) — copied to build/
  build/                # Rendered output (generated by engine build)
```

## Error handling

Errors print to stderr in format: `LEVEL [file:field]: message`. The AI reads the error, fixes the input, and re-runs.

Common errors:
- `Schema validation failed: /field must be string` — data file has wrong type or null instead of empty string
- `Disallowed tag <script> in text field` — text field contains forbidden HTML tag
- `Block-level tag <div> not allowed in text field` — use `{{html:field}}` instead
- `Component not found` — component name typo or file missing

## Important constraints

- **Never edit `build/` directly** — it's regenerated from source on every `engine build`
- **Component CSS is auto-scoped** — write `h1 { ... }` and the engine emits `.component-name h1 { ... }`
- **Global CSS sets baseline** — `global.css` defines typography, colors, spacing for all semantic elements
- **Page order determines wrapping** — first component → `<header>`, last (if named `footer`) → `<footer>`, others → `<section id="...">`
- **Component files are three sections** separated by `---`: template, CSS (optional), JSON schema
