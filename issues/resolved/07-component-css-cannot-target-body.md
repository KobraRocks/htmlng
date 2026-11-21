# Issue: component CSS cannot target `<body>` / `:root` — no escape hatch from class scoping

**Severity**: High (makes presentation and fixed-canvas layouts impossible to express cleanly)
**Found during**: Webinar deck build — first attempt to lay out a 1920×1080 slide
**References**: `src/css.ts:90-113` (`scopeRuleBlock`, `prefixSelectors`), `specs/html-engine.md` C11

**Steps to reproduce**:

1. Create a component whose CSS section declares the page-level layout:

   ```
   body { display: flex; flex-direction: column; height: 100vh; }
   ```

2. Build the page and inspect `build/css/<page>.css`.

**Expected**: some way for a component to style the document root — or an explicit, documented
escape hatch (e.g. `:global(...)`) — because a deck/poster/A4 layout *is* a page-level concern
and the specs state that "Page files are layout-only" (C12), yet page YAML has no field to
express a container or a set of root styles.

**Actual**: the selector is prefixed with the component's own class:

```css
/* emitted */
.deck body { display: flex; flex-direction: column; height: 100vh; }
```

`prefixSelectors()` (src/css.ts:105-113) unconditionally emits `` `${prefix} ${sel}` ``. Since
the component's wrapper **is a child of `<body>`**, `.deck body` can never match. The rule is
silently dead: **no warning, no error, `validate` passes**. The same applies to `html`,
`:root`, `*` and any `@keyframes`-adjacent root usage.

**Impact**

The only working option is to put all layout CSS in `global.css` (the one unscoped file) using
child selectors of the form `body > section#benefits-0`. In this build the result was:

- ~180 lines of layout in `global.css` keyed on engine-generated ids, versus ~40 lines of CSS
  inside the components that were supposed to own their styling;
- component CSS reduced to decoration only, contradicting the stated design goal ("Components
  only style what's unique", C11);
- fragile coupling: the layout breaks if a component is renamed or reordered, because
  `body > section#benefits-0` encodes the engine's assembly order.

**Suggested fixes (in order of preference)**

1. **Escape hatch**: support `:global(sel)` (CSS-Modules semantics), emitting the selector
   unprefixed:
   ```css
   :global(body) { display: flex; }
   body :global(.leaflet-container) { z-index: 1; }
   ```
2. **Root exemption**: never prefix `html`, `body`, `:root`, `@page`, or selectors used inside
   a `@media print` block that already start with `body`/`html`. Low risk: a component prefix
   on those selectors can never match anything anyway, so the current output is never useful.
3. **Declare the intent in page YAML** (complements issue `08`):
   ```yaml
   layout:
     root: true          # unscope this page's layout component
   ```
4. At minimum: **warn** when a scoped component rule starts with `html`, `body` or `:root`, so
   the dead rule is visible instead of silent.

**Workaround used in this build**

All page layout moved to `global.css`, scoped to the engine's generated ids
(`body > section#title-block`, `body.slide-1 > section.benefits`, …), plus a small
`mark-slides.mjs` post-build script to add a per-page class to `<body>` (see issue `08`).
