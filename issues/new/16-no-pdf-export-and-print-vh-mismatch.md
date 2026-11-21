# Issue: no built-in PDF export — `vh`/`vw` are resolved differently by the print engine

> **STATUS (2026-10-06) — partially resolved, kept open for `--pdf`.**
>
> - **Print-safety documentation + reference fixture: done.** The `vh`/`vw` trap is now
>   documented in `README.md`, `skill/SKILL.md` (see "Print and fixed-canvas output"), and
>   `specs/html-engine.md` §7.5. A runnable known-good fixture, `examples/deck/`, was added:
>   two 1280×720 pages using `layout.wrapper: true`, `layout.bodyClass: "deck"`,
>   `@page { size: 1280px 720px; margin: 0 }`, px-only geometry, and a body-end navigation
>   script. It is asserted warning-free by `test/examples.test.ts`.
> - **`build --pdf` (suggested fix 1): deliberately not implemented.** Driving CDP
>   `Page.printToPDF` requires a headless-browser dependency, which conflicts with the
>   engine's zero-new-dependency, deterministic-output position (see `specs/stack.md`). The
>   per-page CSS custom-property workaround (suggested fix 2) is unnecessary once layout uses
>   the fixed-px container pattern shown in `examples/deck/`.
> - **Reopen trigger:** if a headless-browser dependency is accepted, implement
>   `build --pdf` with `preferCSSPageSize: true` and re-check the `examples/deck/` output.

**Severity**: Medium (the deck format is a first-class use case for an agent; PDF is the deliverable)
**Found during**: Webinar deck build — producing `Silar-Vatouva-…-4-slides.pdf` (1920×1080 per page)

**Steps to reproduce**:

1. Build a slide deck sized with viewport units, which is the natural choice given there is no
   page container (issue `09`):
   ```css
   body { height: 100vh; }
   section#title-block { top: 17.5vh; height: 25vh; }
   ```
2. Print to PDF via Chromium:
   ```bash
   chromium --headless=old --no-pdf-header-footer --print-to-pdf=out.pdf file://…/build/slide-1.html
   ```
   with `@page { size: 1920px 1080px; margin: 0; }`.

**Expected**: one 16/9 page per slide, identical to the screen rendering.

**Actual** — several compounding problems, all reproduced:

| Symptom | Observed |
| --- | --- |
| Content pushed off the page | the footer landed on its own second page (`2 pages` for a single slide) |
| Layout reflowed | blocks positioned with `vh` drifted upward; a stats strip was clipped mid-row |
| Exporter-specific resolution | with `--force-device-scale-factor=0.8`, a 1920px-wide `@page` no longer matched the 1920px canvas |
| Physical page size | the same content produced `20 × 11.25 in` pages, and `gs` rasterisation at 96 dpi then stretched the output (a feedback loop that made the PDF look wrong when the PDF was fine) |

The root cause is that the print layout viewport is not the screen viewport: Chromium resolves
`vh` against a print viewport whose height is not 1080px at the requested scale, so all
`vh`-based geometry shifts. This is invisible until you rasterise and measure.

**Workaround used in this build**

Screenshot each slide at 2× (device scale factor 2) and assemble the images into a PDF with
Pillow (`site/tools/export-pdf.mjs`):

```js
chromium --headless=new --force-device-scale-factor=2 --window-size=1920,1080 --screenshot=slide-N.png …
PIL: imgs[0].save(out, save_all=True, append_images=imgs[1:], resolution=288.0)  // → 13.33 × 7.5 in
```

Result: PDF strictly identical to the screen, 4 pages, 13.33 × 7.5 in. Costs: text is no longer
vector/selectable, file size ~1.2 MB, and the pipeline depends on Chromium + Pillow + a local
script — none of which belong in a static-site generator's user workflow.

**Suggested fixes**

1. **Add `htmlng build --pdf`** driven by CDP `Page.printToPDF` with
   `preferCSSPageSize: true` and an explicit paper size derived from the page geometry. This
   would solve the whole class of problem and is a genuine differentiator for deck/poster output.
2. **Emit a print-safe stylesheet**: when a page declares a fixed size
   (`layout: { width: 1920, height: 1080 }`), generate the print variants of the layout rules in
   `px` rather than `vh/vw`, or set a root `--vh` custom property resolved at build time
   (`1vh = 10.8px`) so both media agree.
3. **Document the trap**: one line in the skill — *"`vh`/`vw` are not print-safe; see
   `examples/` for the fixed-canvas pattern"* — plus a `examples/deck/` fixture with a known-good
   `@page` + fixed-size setup. This build spent most of its iterations rediscovering it.
