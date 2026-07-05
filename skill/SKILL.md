---
name: html-engine
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

To update after code changes:
```bash
cd ~/Pi/projects/html-htmlng && npx tsc
```

## Commands

### Project setup

```bash
htmlng init [--name <name>]           # Initialize a new project
```

### Scaffolding

```bash
htmlng create component <name>        # Scaffold a new component
htmlng create page <name>             # Scaffold a new page
htmlng create data <c> --page <p>     # Scaffold a data file (reads schema, fills keys)
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
htmlng validate                        # Validate all pages
htmlng validate page <p>              # Validate one page
htmlng validate component <c>         # Validate one component
```

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
htmlng watch                           # Watch files and rebuild on change
htmlng serve [--port <n>] [--watch]    # Start dev server
```

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

### Creating a new component

```
1. htmlng create component <name>
2. Edit components/<name>.component.html:
   - Template: HTML with {{text:field}}, {{#list:items}}...{{/list:items}}, etc.
   - CSS (after first ---): scoped styles (htmlng prefixes with .<name>)
   - Schema (after second ---): JSON with placeholder definitions
3. htmlng add component <name> --page <page>
4. htmlng create data <name> --page <page>
5. Edit data/<page>/<name>.yaml
6. htmlng render component <name> --page <page>
7. htmlng render page <page>
8. htmlng build
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
| `image` | `{{image:name}}` | `{src, alt, width?, height?, loading?}` | Emits `<img>` element |
| `link` | `{{link:name}}` | `{href, label}` | Emits `<a>` element |
| `list` | `{{#list:name}}...{{/list:name}}` | `array` | Iterates array. Objects → `{{text:field}}`. Scalars → `{{text:this}}`. |
| `bool` | `{{#bool:name}}...{{/bool:name}}` | `boolean` | Renders block only if true |
| `slot` | `{{slot:name}}` | `{component, data?}` | Embeds another component inline |

## Text field HTML whitelist

`text` fields allow these inline tags (everything else is rejected with an error):

`<strong>`, `<b>`, `<em>`, `<i>`, `<a href="...">`, `<code>`, `<br>`, `<mark>`, `<del>`, `<ins>`, `<sub>`, `<sup>`, `<small>`

Only `href` is allowed on `<a>`. No other attributes on any tag. Block-level tags (`<div>`, `<p>`, `<h1>`, etc.) produce an error suggesting to use `{{html:field}}` instead.

### Changing global styles (design tokens)

```
1. Edit design-tokens.yaml (change colors, fonts, spacing)
2. htmlng build                        (rebuild all pages)
3. htmlng serve [--watch]              (preview in browser)
```

### Previewing component styling

```
1. Edit components/<name>.component.html CSS section
2. htmlng render component <name> --page <page> --with-css
3. Save output to .html file and open in browser
4. Or: htmlng preview component <name> --with-css (sample data)
```

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
- `Component not found` — component name typo or file missing

## Important constraints

- **Never edit `build/` directly** — it's regenerated from source on every `htmlng build`
- **Component CSS is auto-scoped** — write `h1 { ... }` and the htmlng emits `.component-name h1 { ... }`
- **Global CSS sets baseline** — `global.css` defines typography, colors, spacing for all semantic elements
- **Page order determines wrapping** — first component → `<header>`, last (if named `footer`) → `<footer>`, others → `<section id="...">`
- **Component files are three sections** separated by `---`: template, CSS (optional), JSON schema
