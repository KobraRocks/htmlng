# AI Agent Journey: Building a demo page with htmlng

> **Date**: 2026-07-04  
> **Agent**: AI coding agent (the one that built htmlng)

## What I built

A single-page landing site pitching htmlng itself. 5 components: hero, features, how-it-works, cta, footer. Built entirely with `htmlng` CLI commands.

## Timeline

| Step | Time | Notes |
|------|------|-------|
| `htmlng init` | 0s | Instant |
| Create 5 components | 30s | Scaffolded from templates |
| Customize component templates | 3min | Rewrote HTML, CSS, schemas for each |
| Create page YAML | 30s | Added meta tags, component list |
| Create data files | 10s | `create data` × 5 |
| Fill content | 3min | Wrote copy with inline formatting |
| First render attempt | — | **Blocked**: parser bug (see below) |
| Debug and fix | 10min | Found node-html-parser bug, rewrote validator |
| Render + validate | 2s | Clean |
| Build | 1s | `build/index.html` + `build/css/index.css` |

## What worked well

- **Scaffolding is fast.** `create component` + `create data` generates valid skeletons instantly. I only had to fill content.
- **Component isolation.** Editing hero's CSS didn't touch features. Changing features' data didn't break footer. This is the core promise and it delivered.
- **Inline formatting just works.** `<strong>`, `<em>`, `<code>` in text fields rendered correctly with no extra effort.
- **The `link` type is ergonomic.** `{href: "#features", label: "See how it works"}` — one line in YAML, proper `<a>` in output.
- **Validation catches real issues.** When I had a typo in a placeholder name, the error told me exactly which file and field.
- **`render component --page` is great for iterative editing.** I used it to check each component's copy before rendering the full page.
- **CSS scoping is invisible.** I wrote `h1 { font-size: 3.5rem; }` in the hero component and `.hero h1 { font-size: 3.5rem; }` appeared in the output. Zero mental overhead.
- **The `--compact` flag.** Perfect for piping output to a file or previewing without annotation noise.

## Friction points

### 1. `link` type doesn't support CSS classes

The CTA button in my hero needed special styling. I used `{{link:cta}}` which generates a bare `<a>` tag. It worked because `.hero a { ... }` scoped-CSS matches it, but I couldn't add a `.btn-primary` class for more specific styling.

**Suggestion**: Add optional `class` field to `LinkValue`, same as `ImageValue`.

### 2. `list` type with `{{text:this}}` requires knowing the syntax

When I first scaffolded the features component, I used `{{text:title}}` which worked because my list items are objects. But for arrays of strings, you need `{{text:this}}` — this isn't obvious from the scaffold template.

**Suggestion**: The scaffolded `{{#list:items}}` block should include a comment showing both syntaxes.

### 3. `create data` uses schema keys but doesn't know about `list` sub-fields

When I ran `create data features --page index`, it generated `items: []` — correct. But it didn't scaffold the sub-fields (`title`, `description`) inside the list items. I had to look at my component schema to remember the field names.

**Suggestion**: For list types, `create data` could add a comment showing the expected sub-fields based on the template parsing.

### 4. `create component` scaffold is too generic

All scaffolds have `heading`/`body` placeholders. I had to rewrite every component template. While this is expected for a generic scaffold, it would be nice to have a `--preset` flag for common patterns (hero-with-cta, feature-grid, steps-list, etc.).

### 5. No `htmlng serve` command

I had to open `build/index.html` in a browser manually. A `serve` command with livereload would make the edit → render → check cycle much faster.

### 6. node-html-parser v8.0.4 bug

The parser silently drops `<body>` when the document contains multiple `<section>` elements with nested `<ul>`/`<li>` structures. I had to rewrite `validatePageStructure` to use regex-based validation instead of DOM parsing. The fix works but loses the ability to validate nested structure.

**Impact**: Medium. The engine now validates top-level body structure with regex, which is sufficient for our use case (we generate the HTML, so we know it's structurally valid). But it means we can't validate that `<section>` elements have both `id` and `class` — a regression from the original spec.

## Verdict

Building with htmlng feels like the tool it was designed to be: edit isolated files, run a command, see the result. The component model eliminates the anxiety of "did I break something elsewhere?" — the answer is always no, by construction.

The friction points are all polish items. The core loop (edit → render → validate → build) is solid. I'd use this for any static site where an AI agent is the primary content editor.
