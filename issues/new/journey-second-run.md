# AI Agent Journey: Second run — pitching htmlng

> **Date**: 2026-07-05  
> **Agent**: AI coding agent  
> **Project**: `/tmp/htmlng-pitch/`

## What I built

A 7-component landing page pitching htmlng: hero, problem, solution, features (6 cards), how-it-works (4 steps), cta, footer. Custom design tokens for a dark navy brand palette.

## Timeline

| Step | Time | Notes |
|------|------|-------|
| `htmlng init` + customize tokens | 1min | Edited `design-tokens.yaml` — 23 values, clean YAML |
| Scaffold 7 components + page | 30s | All scaffolds now include placeholder reference in CSS comments |
| Customize component templates | 4min | Hero, features, and how-it-works needed full rewrites. Problem, solution, footer kept scaffold structure with CSS tweaks |
| Create data files | 10s | `create data` × 7, instant |
| Fill content | 4min | Copy-writing. Used `<strong>`, `<em>`, `<code>` extensively in text fields |
| Validate | 2s | Clean pass |
| Render + inspect | 5s | Checked hero and problem components individually first |
| Build | 1s | Design tokens resolved correctly in CSS output |

## What improved since first run

### 1. Design tokens are a game-changer

Editing `design-tokens.yaml` to set a dark navy palette (`#1a1a2e`) instantly changed every component's colors. No hunting through CSS files. The `{{primary}}` placeholder pattern in `global.css` is intuitive — it mirrors the component placeholder system exactly.

### 2. Scaffold placeholder reference is helpful

The CSS comment section now documents all 7 placeholder types with examples. When I was customizing the features component with `{{#list:items}}`, I referenced the comment to confirm the `{{text:this}}` syntax for scalar arrays. Didn't need to open docs.

### 3. Validation catches issues early

I accidentally wrote `heading: "text"` instead of `heading: "The Problem"` on the problem component. The error `Schema validation failed: /heading must be string` told me exactly what was wrong, where, and why. Fixed in seconds.

### 4. `link` type with scoped CSS just works

The hero CTA uses `{{link:cta}}` with `{ href: "#problem", label: "See the problem" }`. The scoped CSS `.hero a { ... }` styles it without needing an explicit class. Clean separation: the link type handles semantics, CSS handles presentation.

### 5. `create data` generates helpful list stubs

For the features component, `create data` generated:
```yaml
# Expected fields per item: title, description
items:
  - title: ""
    description: ""
```

This saved me from checking the component schema. The `# Expected fields` comment is generated from parsing the template's `{{#list:items}}` block.

## Remaining friction

### 1. No component reordering without editing page YAML

I wanted to swap problem/solution order. Had to manually edit `pages/index.page.yaml`. An `htmlng move component <name> --page <page> --before <other>` command would help.

### 2. No way to preview a single component's styling

`htmlng preview component hero` shows HTML with sample content, but doesn't include CSS. I had to render the full page to see styled output. A `--with-css` flag on preview would help.

### 3. Component CSS editing requires full page render

When I tweaked the hero's `h1 { font-size: 3.5rem; }`, I had to render the full page to check if it looked right. A render that includes just that component's HTML + the page's compiled CSS would be faster.

### 4. No hot reload in serve mode

`htmlng serve` works but requires manual browser refresh after `htmlng build`. A watch+serve combo or livereload injection would close the loop.

## Verdict

This run was significantly smoother than the first. Design tokens eliminated the global CSS editing friction. The scaffold improvements made component creation faster. The `create data` list hints saved schema-checking time. The core loop (edit → render → validate → build → serve) is solid and predictable.

The remaining friction points are all around the edit-inspect cycle: faster component-level CSS preview, hot reload, component reordering. None block productivity — they'd just make it faster.
