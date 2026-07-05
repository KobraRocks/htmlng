# htmlng — Deterministic HTML Engine for AI Agents

Component-based static HTML page generator. AI agents edit isolated component templates and data files; the engine assembles pages with zero risk of collateral damage to other components.

## Install

```bash
cd ~/Pi/projects/html-engine
npm link
```

After source changes, rebuild with `npx tsc`.

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
| `htmlng create component <name>` | Scaffold a new component |
| `htmlng create page <name>` | Scaffold a new page |
| `htmlng create data <c> --page <p>` | Scaffold a data file |
| `htmlng render component <c> --page <p>` | Render component inner HTML to stdout |
| `htmlng render component <c> --all` | Render component across all pages |
| `htmlng render page <p> [--compact]` | Render full page to stdout |
| `htmlng preview component <c>` | Preview with sample data |
| `htmlng validate` | Validate all pages |
| `htmlng build [page <p>]` | Write pages to build/ directory |
| `htmlng diff [page <p>]` | Show unified diff vs last build |
| `htmlng add component <c> --page <p>` | Add component to page |
| `htmlng list pages\|components\|data [<p>]` | List resources |
| `htmlng watch` | Watch files and rebuild on change |

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

Three sections separated by `---`: template, CSS (scoped automatically), JSON schema.

### Placeholder types

| Type | Syntax | Use |
|------|--------|-----|
| `text` | `{{text:name}}` | Text with safe inline formatting |
| `html` | `{{html:name}}` | Raw HTML for block content |
| `image` | `{{image:name}}` | `<img>` element |
| `link` | `{{link:name}}` | `<a>` element |
| `list` | `{{#list:name}}...{{/list:name}}` | Repeated items |
| `bool` | `{{#bool:name}}...{{/bool:name}}` | Conditional block |
| `slot` | `{{slot:name}}` | Nested component |

### Page structure

The first component renders as `<header>`, the last (if named `footer`) as `<footer>`, and everything else as `<section id="name" class="name">`.

## Docs

- [Functional specification](specs/html-engine.md)
- [Technology stack](specs/stack.md)
- [Implementation plan](specs/implementation-plan.md)

## Dev

```bash
npm test              # 42 tests
npm run typecheck     # tsc --noEmit
npx tsx src/index.ts  # run without building
```
