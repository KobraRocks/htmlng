# Issue: page scripts must live in `<head>` — `document.body` does not exist when they run

**Severity**: Medium (unexpected constraint + a real footgun for any page-level script)
**Found during**: Webinar deck build — adding arrow-key navigation to the slides
**References**: `src/validator.ts:325-337` (`PAGE_BODY_CHILD`), `src/renderer.ts:153-160` (body scripts), `specs/html-engine.md`

**Steps to reproduce**:

1. Declare a page script the way any developer would (at the end of the document):
   ```yaml
   scripts:
     - src: "../assets/deck-nav.js"
   ```
2. `node dist/index.js validate`

**Expected**: the script is emitted just before `</body>`, so the DOM is available.

**Actual**:
```
ERROR  Disallowed direct child of <body>: <script>.
Only <header>, <section id="...">, and <footer> are allowed.   [PAGE_BODY_CHILD]
```
The workaround is `head: true`:
```yaml
scripts:
  - src: "../assets/deck-nav.js"
    head: true
```
which emits `<script src="…"></script>` **in `<head>`**, i.e. before `<body>` is parsed. At that
moment `document.body === null`, and any init code reading it throws or silently no-ops.

**Observed failure mode (real, cost one debugging cycle)**

The navigation script computed its slide index at load time:

```js
var match = (document.body.className || '').match(/slide-(\d+)/);   // TypeError in <head>
```

In `<head>` this threw `Cannot read properties of null`, the whole IIFE aborted, and the
symptoms were **"navigation partly works, hints absent"** rather than a visible error — the
keydown listener had already been registered before the throw. The fix was to defer every DOM
read until `DOMContentLoaded`:

```js
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', buildHints);
} else {
  buildHints();
}
```

**Suggested fixes**

1. **Allow body-end scripts** (they are harmless for determinism, and it is the only way a page
   script can assume a parsed DOM). Keep them out of component templates — that rule makes
   sense — but a page is not a component.
2. If `<head>` scripts must stay the only option, **document the contract** in the skill:
   *"page scripts are emitted in `<head>`; any DOM access must wait for `DOMContentLoaded`"*.
3. Emit `defer` automatically when `head: true` and no `defer`/`async` is specified. `defer`
   scripts in `<head>` execute after parsing, which is exactly the desired semantics and makes
   the whole class of bug disappear:
   ```html
   <script src="…" defer></script>
   ```
4. Validator message improvement: mention the `head: true` escape and the `defer` caveat in the
   `PAGE_BODY_CHILD` explanation (see issue `14` on the `explain` catalogue).
