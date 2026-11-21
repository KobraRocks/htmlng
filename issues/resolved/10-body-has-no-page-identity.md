# Issue: `<body>` carries no page identity — per-page variation requires a post-build script

**Severity**: Medium-High (forces an out-of-engine build step for a very common need)
**Found during**: Webinar deck build — different vertical rhythm per slide (1: 2×2 cards, 2: 3 columns, 3: 6 rows, 4: 4 columns)
**References**: `src/renderer.ts:124-140` (head/body assembly)

**Steps to reproduce**:

1. Create two pages using the same components but needing different layout constants
   (e.g. `slide-1` with `top: 45.6vh` and `slide-2` with `top: 39vh` for the same block).
2. Try to express that difference without a per-page hook.

**Expected**: an identifier on the root element, e.g.
```html
<body class="slide-1" data-page="slide-1">
```
or any documented way to select "this page" from CSS.

**Actual**: `<body>` is emitted bare:

```html
<body>
```

The per-page CSS is a **separate file** (`build/css/slide-1.css`) but it is linked from a
document whose root has no page-specific hook, so `body.slide-1 > section#benefits-0` cannot be
written. The only alternatives are (a) styling by component id, which encodes assembly order and
breaks on reorder, or (b) injecting a class after the build.

**Consequences observed**

A `site/tools/mark-slides.mjs` post-build step had to be written and added to `build.sh`:

```js
const marked = html.replace('<body>', `<body class="slide-${index}">`);
```

It works, but it means:

- `htmlng build` alone does **not** produce the final artifact — the engine's output is not
  usable as-is, and any consumer (preview server, CI, PDF export) must remember the extra step;
- `validate` runs before the marking, so validated HTML ≠ shipped HTML;
- the class name is derived from **build order**, coupling the deck's design to the file
  ordering (see issue `14` on alphabetical page sorting);
- a second run of the script warns "already marked" or silently double-marks.

**Suggested fixes**

1. Emit the page name on the root element, unconditionally:
   ```html
   <body id="page-{{page}}" class="{{page}}" data-page="{{page}}">
   ```
   Cheap, no API change, immediately unlocks `body.<page> …` selectors and makes the page CSS
   self-scoping (`build/css/slide-1.css` finally matches its own root).
2. Or expose it through page YAML:
   ```yaml
   bodyClass: "slide-1 deck"
   ```
3. Or generate a per-page CSS custom property on `:root` (`--page: slide-1`) so components can
   branch on it without selector gymnastics.

**Note**: option 1 would have removed the need for the post-build script entirely in this build.
