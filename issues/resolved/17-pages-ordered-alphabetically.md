# Issue: pages are ordered alphabetically — `slide-10` sorts before `slide-2`

**Severity**: Low (but it silently reorders deliverables)
**Found during**: Webinar deck build — four slides, PDF assembly order, per-slide class injection
**References**: `src/cli.ts:524` (build-all order), `src/page.ts` (`findPages` → `readdirSync` order)

**Steps to reproduce**:

1. Create pages `slide-1.page.yaml` … `slide-10.page.yaml`.
2. `node dist/index.js build` (all pages), then look at the order of `pages` in the JSON output,
   the order in which pages are built, or use `node tools/mark-slides.mjs` (which derives the
   slide index from file order).

**Expected**: a deterministic **natural** order (`slide-1`, `slide-2`, …, `slide-10`), or an
explicit order.

**Actual**: lexicographic ordering, so `slide-10` precedes `slide-2`. Any tooling that derives
sequence from order — a PDF assembly loop, a per-slide counter, a "next slide" link, the
`overflow: hidden` canvas class — inherits the wrong sequence.

In this build the coupling was real:

- `site/tools/mark-slides.mjs slide-1 slide-2 slide-3 slide-4` passes the order explicitly and
  assigns `<body class="slide-N">`, where `N` is also the **visual** slide number shown in the
  page counter and in the CSS layout rules. A different order silently mislabels every slide;
- `site/tools/export-pdf.mjs` iterates its own hard-coded `slides` array, so PDF order and page
  order can drift apart with nothing to detect it.

**Suggested fixes**

1. **Natural sort** in `findPages` (`localeCompare` with `{ numeric: true }`), which fixes the
   common case with a one-line change.
2. **Explicit order** in `engine.config.yaml`, useful for decks and docs:
   ```yaml
   order: [slide-1, slide-2, slide-3, slide-4]
   ```
3. **Optional front matter** in the page YAML (`order: 3`, `weight: 30`) — most robust, no
   central file to keep in sync.
4. At minimum, document that build order is lexicographic, and have `list pages` print the order
   actually used (it does print a list — making the ordering guarantee explicit in `schema` would
   be enough to avoid the trap).
