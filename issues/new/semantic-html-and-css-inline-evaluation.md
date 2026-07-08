---
title: "Evaluation: External CSS & Div Soup in Generated Reports"
created: 2026-07-07
tags: [html-engine, semantic-html, css-inline, div-soup, evaluation]
status: open
---

# Evaluation: External CSS & Div Soup in Generated Reports

Two issues were discovered in output at `../homnox/reports/build/` (parris-lancaster.html, tech-to-finance-pivot-case-studies.html).

---

## Issue 1: External CSS Instead of Inlined `<style>`

### Observation

Both reports use:

```html
<link rel="stylesheet" href="css/parris-lancaster.css">
```

CSS is written to `build/css/` as separate files. This means:
- Reports are not self-contained — moving the `.html` breaks styling
- Two files per report instead of one
- No option for single-file portability

### Root Cause

The engine always emits an external `<link>` tag at `renderer.ts:83`:

```typescript
head += `  <link rel="stylesheet" href="css/${pageName}.css">\n`;
```

And `cmdBuild` in `cli.ts:268` writes the CSS to a separate file:

```typescript
writeFileSync(join(buildDir, 'css', `${p}.css`), assemblePageCSS(allComps, globalCSS));
```

The spec (§7.2 Structural Guarantees) explicitly says: *"All CSS is external, one file per page."* This was a deliberate design choice — not a bug. But that design choice doesn't serve all use cases (especially standalone reports).

### Needed Enhancement

The engine should support CSS inlining. The feature needs:

1. **A config/build flag** to control behavior (e.g., `build.inlineCSS: true` in `engine.config.yaml` or `--inline-css` CLI flag on `build`/`render page`)
2. **Three modes**:
   - `external` (default, current behavior): `<link rel="stylesheet" href="css/page.css">` + CSS file
   - `inline`: CSS assembled in `<style>` tag in `<head>`, no external file
   - `both`: external file + inline fallback (overkill for now, skip)

3. **Implementation in `renderPage()`**: Instead of always emitting `<link>`, conditionally emit either `<link>` or `<style>...</style>` based on the config flag. The `cmdBuild` handler would also conditionally skip writing the CSS file.

4. **Implementation in `htmlng serve`**: The dev server in watch mode already rebuilds and writes CSS on file change (lines 486-494). It needs the same conditional logic.

**Files to change**: `src/renderer.ts`, `src/cli.ts`, `src/types.ts` (add `inlineCSS` to `EngineConfig`), `src/config.ts` (parse + default), `src/scaffold.ts` (include in generated config).

### Priority: High — blocks single-file report delivery

---

## Issue 2: `<div>` Soup and Class Overuse

### Observation

The rendered HTML shows heavy use of `<div>` wrappers and class attributes:

```html
<header id="report-header" class="report-header">   <!-- engine wrapper -->
  <div class="report-header">                        <!-- redundant div! -->
    <div class="meta">
      <span class="date">2026-07-07</span>
      <span class="audience">Homnox FinPro ...</span>
    </div>
    <h1>...</h1>
  </div>
</header>

<section id="exec-summary" class="exec-summary">     <!-- engine wrapper -->
  <div class="exec-summary">                          <!-- redundant div! -->
    <h2>Executive Summary</h2>
    <p>...</p>
  </div>
</section>

<section id="section-1" class="section-1">           <!-- engine wrapper -->
  <div class="section-wrapper">                      <!-- generic wrapper div -->
    <h2>Section 1: ...</h2>
    <p>...</p>
  </div>
</section>
```

This contradicts:
- **C1** (spec): "Pure semantic HTML — no frameworks, no `<div>` soup."
- The spirit of semantic HTML, which uses elements like `<header>`, `<section>`, `<h1>`-`<h6>`, etc. directly rather than nesting them inside presentation-only `<div>`s.

### Root Cause Analysis

There are two layers creating the problem:

#### Layer 1: Engine Wrapper (`renderer.ts:100-110`)

```typescript
if (i === 0) {
  body += `  <header ${id} ${cls}>\n${indent(html, 4)}\n  </header>\n`;
} else if (i === renderedComponents.length - 1 && name === 'footer') {
  body += `  <footer ${id} ${cls}>\n${indent(html, 4)}\n  </footer>\n`;
} else {
  body += `  <section ${id} ${cls}>\n${indent(html, 4)}\n  </section>\n`;
}
```

Where `id = id="component-name"` and `cls = class="component-name"`. The engine correctly wraps each component in a semantic tag with `id` and `class`. The `id` satisfies C2 (direct navigation). The `class` is **required** for CSS scoping — the CSS scoper (`css.ts`) prefixes all component CSS selectors with `.component-name`, and the outer semantic element carries that class so selectors like `.report-header .meta` match.

**The engine side is correct.** The semantic wrapper + class is necessary and minimal.

#### Layer 2: Component Templates (user-authored / AI-authored)

Every component template wraps its content in a `<div>`:

```html
<!-- report-header.component.html -->
<div class="report-header">
  <div class="meta">
    <span class="date">{{text:date}}</span>
    <span class="audience">{{text:audience}}</span>
  </div>
  <h1>{{text:title}}</h1>
</div>
```

```html
<!-- exec-summary.component.html -->
<div class="exec-summary">
  <h2>Executive Summary</h2>
  {{html:body}}
</div>
```

```html
<!-- report-section.component.html -->
<div class="section-wrapper">
  <h2>{{text:heading}}</h2>
  {{html:body}}
</div>
```

These component-level `<div>` wrappers are **redundant** because:
1. The engine's semantic wrapper already provides the `class="component-name"` for CSS scoping
2. The content inside is already semantically correct (`<h1>`, `<h2>`, `<p>`, etc.)
3. The inner `<div>` adds a DOM node with no structural or semantic value

The `<div class="meta">` in `report-header` is a legitimate grouping element (two `<span>`s that form a metadata row). But the outer `<div class="report-header">` is pure noise.

### Why Did This Happen?

Two reasons:

1. **The SKILL.md doesn't explicitly teach semantic component authoring.** The skill tells agents to use the three-section format (template | CSS | schema) but doesn't mention that the engine provides the semantic wrapper and the component template should be the *inner content only* — no wrapper `<div>`.

2. **The component scaffolding / presets likely include `<div>` wrappers.** If the preset template uses `<div class="component-name">`, agents will copy that pattern. The `scaffold.ts` needs to be checked.

3. **No validation warns about redundant wrappers.** The validator checks for `<script>`, `<style>`, and `style="..."` in templates, but doesn't check for unnecessary `<div class="component-name">` that duplicates the engine's wrapper.

### What Should Clean Components Look Like?

```html
<!-- report-header.component.html (cleaned) -->
<div class="meta">
  <span class="date">{{text:date}}</span>
  <span class="audience">{{text:audience}}</span>
</div>
<h1>{{text:title}}</h1>
---
.report-header .meta { ... }
.report-header h1 { ... }
---
{ ... }
```

```html
<!-- exec-summary.component.html (cleaned) -->
<h2>Executive Summary</h2>
{{html:body}}
---
.exec-summary { max-width: var(--max-width); margin: 0 auto; }
---
{ ... }
```

```html
<!-- report-section.component.html (cleaned) -->
<h2>{{text:heading}}</h2>
{{html:body}}
---
/* No wrapper needed - global.css sets section defaults */
---
{ ... }
```

The CSS selectors work because:
- Engine emits `<section id="exec-summary" class="exec-summary">`
- Component CSS `.exec-summary { ... }` is already scoped and matches the engine's wrapper
- Component CSS `.exec-summary h2 { ... }` matches the `<h2>` *directly inside* the engine's `<section>`

### Needed Enhancements

**A. Skill documentation** (`SKILL.md`): Add a section on **semantic component authoring**:

```markdown
## Semantic component authoring

The engine wraps every component in a semantic tag with `id` and `class` matching the
component name. Your component template is the **inner content only** — do NOT add a
wrapper `<div class="component-name">` because the engine already provides it.

✅ Good (clean):
  <h2>Executive Summary</h2>
  {{html:body}}

❌ Bad (redundant):
  <div class="exec-summary">
    <h2>Executive Summary</h2>
    {{html:body}}
  </div>

✅ Good (semantic grouping):
  <h2>{{text:heading}}</h2>
  <p>{{text:subtext}}</p>
  <ul>
    {{#list:features}}
    <li>{{text:title}}</li>
    {{/list:features}}
  </ul>

❌ Bad (div soup):
  <div class="features-wrapper">
    <div class="features-header">
      <h2>{{text:heading}}</h2>
    </div>
    <div class="features-list">
      <ul>...</ul>
    </div>
  </div>
```

**B. Validation warning**: Add a check in `validator.ts` for components whose template is a single `<div class="component-name">` wrapping all content. Emit a `WARNING` suggesting removal.

**C. Preset templates**: Review and clean up built-in presets (if any exist) to use semantic patterns without wrapper `<div>`s. Check `templates/component.html` and `presets/`.

**D. Existing component fixes**: The `reports/components/` directory needs cleanup — all `.component.html` files should have their outer `<div class="...">` wrapper removed.

### Priority: Medium-High — structural quality issue, degrades semantic HTML commitment

---

## Summary of Changes Needed

| # | What | Where | Effort |
|---|------|-------|--------|
| 1 | CSS inlining: `build.inlineCSS` config + `--inline-css` flag | `types.ts`, `config.ts`, `renderer.ts`, `cli.ts`, `scaffold.ts` | Medium |
| 2 | Skill doc: add semantic authoring section | `SKILL.md` | Small |
| 3 | Validator: warn on redundant `<div class="component-name">` wrapper | `validator.ts` | Small |
| 4 | Presets/templates: remove wrapper divs from scaffold templates | `scaffold.ts`, `templates/` | Small |
| 5 | Existing component cleanup: remove wrapper divs from reports/components/ | `reports/components/*.component.html` | Manual |

## Implementation Order

1. **Skill doc** (#2) — prevent future issues immediately
2. **Existing component cleanup** (#5) — fix current reports
3. **CSS inlining** (#1) — new feature, requires engine changes
4. **Validator warning** (#3) — safety net
5. **Preset cleanup** (#4) — prevent future scaffolds from being wrong
