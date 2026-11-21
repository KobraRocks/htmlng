# Issue: wrapper semantics are positional — `components[0]` becomes `<header>`, a shell component becomes `<footer>`

**Severity**: Medium (surprising, and it forces an awkward component order)
**Found during**: Webinar deck build — declaring a `deck` shell component to carry the page layout
**References**: `src/renderer.ts:136-152`

**Steps to reproduce**:

1. Declare a page whose last component is the page shell:
   ```yaml
   components: [header, title-block, benefits, stats, footer, deck]
   ```
2. `node dist/index.js build`

**Expected**: the shell is emitted as a neutral element (`<div class="deck">` or
`<section id="deck">`), and structural roles come from the component names, not from position.

**Actual**:

```html
<header id="header" class="header">…</header>
<section id="title-block" class="title-block">…</section>
…
<footer id="footer" class="footer">…</footer>
<footer id="deck" class="deck">…</footer>        <!-- the shell, as a <footer> -->
```

Two problems:

- a component named `deck` is emitted as `<footer>`, so any selector written against
  `section#deck` silently fails — I lost two iterations to this before dumping the DOM;
- and the **only** way to avoid it was to declare the shell **first**, which then made it the
  `<header>`:
  ```html
  <header id="deck" class="deck"><span class="deck-marker" hidden>slide-1</span></header>
  ```
  Workable (its content is `display:none`), but it means the page's first "header" is not a
  header, and the real header component is a `<section>`. Every positional assumption in the
  CSS has to be re-checked.

**Suggested fixes**

1. **Declarative roles** in the page YAML:
   ```yaml
   components:
     - deck            # role: section (default) → <section id="deck">
     - header          # role: header  → <header id="header">
     - …
     - footer          # role: footer  → <footer id="footer">
   ```
   with the current positional rules kept only as defaults when no role is given.
2. Or **name-based only**: `header` → `<header>`, `footer` → `<footer>`, everything else →
   `<section>`, and drop the "first child is always a header" rule. That single change fixes this
   issue with no API addition, and would have made `deck` work as authored.
3. Document explicitly in the skill and in `schema.pageFile.assembly` that
   *the first component always becomes `<header>`*, ideally with the resulting markup shown, so
   the surprise is visible before the first build.
