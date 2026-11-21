# Issue: no page-level container — only `header`/`section`/`footer` may be direct children of `<body>`

**Severity**: High (blocks any fixed-canvas or wrapped layout: slides, posters, A4 documents)
**Found during**: Webinar deck build — laying out a 4-slide presentation at 1920×1080
**References**: `src/renderer.ts:136-152` (body assembly), `src/validator.ts:325-337` (`PAGE_BODY_CHILD`), `specs/html-engine.md:546` (wrapper rules)

**Steps to reproduce**:

1. Declare a page with several components:
   ```yaml
   components: [header, title-block, benefits, stats, footer]
   ```
2. Open the generated `build/<page>.html`.

**Expected**: a container element wrapping the page content, so that layout can be expressed
once (flex, grid, fixed canvas, print size) — or a documented way to declare one. `specs/html-engine.md`
says "Page files are layout-only" (C12), but page YAML has **no field to express layout**: only
an ordered list of components. So layout has nowhere to live.

**Actual**: components are emitted as **flat siblings of `<body>`**, with no wrapper:

```html
<body>
  <header id="header" class="header">…</header>     <!-- components[0] -->
  <section id="title-block" class="title-block">…</section>
  <section id="benefits-0" class="benefits">…</section>
  <section id="stats" class="stats">…</section>
  <footer id="footer" class="footer">…</footer>     <!-- components[-1] named footer -->
</body>
```

and the structure validator **forbids any other direct child**:

```
ERROR  Disallowed direct child of <body>: <script>.
Only <header>, <section id="...">, and <footer> are allowed.   [PAGE_BODY_CHILD]
```

**Consequences observed**

1. **No common flex/grid container.** `display: contents` on a wrapper component cannot promote
   its children into a parent flow, because there is no parent: the repeated components are
   themselves the direct children. A 2×2 grid of four cards therefore has to be expressed as
   four top-level `body > section#benefits-N` rules with hand-computed widths.
2. **No fixed canvas.** A 1920×1080 slide needs one element to own the canvas. Here the canvas
   had to be `<body>` itself, which then required a per-page class injected by a post-build
   script (see issue `08`).
3. **Navigation scripts cannot be placed after content.** A `<script>` at the end of `<body>`
   is rejected by `PAGE_BODY_CHILD`, so page scripts must go in `<head>` — where `document.body`
   does not exist yet (issue `12` gives the workaround).
4. **Wrapper semantics are positional**, not declarative: `components[0]` becomes `<header>`,
   `components[-1]` becomes `<footer>` only if it is named `footer`. A "shell" component
   declared last silently becomes `<footer id="deck">`.

**Suggested fixes**

1. **Add a page-level wrapper** (simplest, backwards compatible behind a flag):
   ```yaml
   layout:
     wrapper: true            # or wrapper: "page"
   ```
   emitting
   ```html
   <body><div id="page" class="page">…components…</div></body>
   ```
   with the validator allowing exactly one such wrapper (or allowing a component to *be* the
   wrapper via `layout.wrapper: deck`).
2. **Make the wrapper rule declarative** rather than positional:
   ```yaml
   components:
     - deck            # emits <div class="deck">
     - header
     - …
   ```
   today this emits `<header id="deck" class="deck">`, which is surprising and forced a
   workaround here (the shell had to be declared **first** to avoid becoming a `<footer>`,
   leaving an empty `<header>`).
3. **Allow `display: contents` shells** by permitting an extra non-semantic wrapper element
   (`div`, `nav`, `script`) as a `<body>` child, behind a strict count (e.g. at most one
   `div#page` and scripts only with `defer`).

**Workaround used in this build**

`<body>` is the slide canvas: `global.css` declares `body { height: 100vh; padding: 0 }`, each
component is absolutely positioned by id (`body > section#title-block { top: 17.5vh }`), and a
post-build script (`site/tools/mark-slides.mjs`) injects the page class
(`<body class="slide-3">`) because the engine exposes no per-page hook (issue `08`).
It works, and prints correctly, but the layout is blind to document order: adding a component
means hand-editing every `top` in `global.css`.
