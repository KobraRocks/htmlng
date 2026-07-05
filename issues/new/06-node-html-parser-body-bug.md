# Issue: node-html-parser v8.0.4 drops `<body>` on complex nested sections

**Severity**: High (blocked rendering)  
**Found during**: Building demo page with 5 components

**Steps to reproduce**:
1. Create a page with hero, features (with `<ul>`/`<li>`), how-it-works (with `<ol>`/`<li>`), cta, and footer components
2. Run `htmlng render page index`

**Expected**: Page renders with body structure validation passing.

**Actual**: `ERROR: Page must have a <body> element` — `node-html-parser`'s `parse()` returns a root with 0 childNodes, and `querySelector('body')` returns null even though the HTML has a valid `<body>` tag.

**Root cause**: `node-html-parser` v8.0.4 has a parsing bug when the document contains multiple `<section>` elements with nested `<ul>`/`<li>` or `<ol>`/`<li>` structures. The parser silently drops the `<body>` wrapper and hoists its children to the root.

**Workaround applied**: Replaced DOM-based validation in `validatePageStructure` with regex-based string matching. Validates top-level body children and duplicate IDs without parsing the full DOM tree.

**Fix**: Either:
1. Upgrade `node-html-parser` when a fix is available
2. Switch to `parse5` for spec-compliant HTML parsing
3. Keep regex-based validation (simpler, no dependency on parser correctness)
