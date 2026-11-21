# Issue: `list` data shape is documented backwards — array-of-objects means "repeat the whole component"

**Severity**: High (wasted significant time; the documented shape fails validation)
**Found during**: Webinar deck build — four benefit cards, then three formula columns, three levels, six sales steps
**References**: `src/format-spec.ts:36` (`dataShape`), `src/renderer.ts:75-90` (array root handling), `src/template.ts:139-152` (`resolveList`), `specs/html-engine.md:499`

**Steps to reproduce**:

1. Read the machine spec:
   ```bash
   node dist/index.js schema
   ```
   which states for `list`:
   ```
   "syntax": "{{#list:name}}...{{/list:name}}",
   "dataShape": "array of objects, or array of scalars",
   "notes": "Object items use {{text:field}}; scalar items use {{text:this}}."
   ```
   and in `componentFile.schemaEntry` there is an `item` sub-definition in the example.

2. Write the obvious data file for a repeatable component:
   ```yaml
   benefits:
     - index: "01"
       title: "…"
       body: "…"
   ```
   with the intuitive schema:
   ```json
   { "benefits": { "type": "list", "required": true },
     "item": { "index": {"type":"text"}, "title": {"type":"text"}, "body": {"type":"text"} } }
   ```

3. `node dist/index.js validate`

**Expected**: validation passes and the component renders four times.

**Actual**: two distinct failures, both misleading:

```
ERROR  Schema validation failed: (root) must have required property 'benefits'   [SCHEMA_VALIDATION]
ERROR  Template uses placeholder "index" but schema has no matching entry.        [TEMPLATE_PLACEHOLDER_UNKNOWN]
```

The truth, only discoverable by reading the renderer:

- **the whole data file must be a YAML sequence** — `renderer.ts:75` checks `Array.isArray(data)`
  and repeats the component once per element;
- **per-item fields must be declared at the schema's top level** (flat), not nested under
  `item` — `validatePageData` validates each element against the flat schema;
- `{{#list:name}}` is therefore only for **nested** lists *inside* a component instance
  (`resolveList(data[name])`), a different feature that the docs conflate with the first.

**Consequences observed**

- Four components (benefits, formulas, levels, stats) had to be reshaped from "one component
  with `{{#list}}`" to "one component per instance, flat schema";
- repeated components emit **one `<section>` per item** with indexed ids (`benefits-0`,
  `benefits-1`, …) and the markup cannot be wrapped in a grid container — because each section
  is `display: contents`-unfriendly and the parent flow is `<body>` (see issue `09`). A 2×2 card
  grid became four absolutely positioned sections;
- when a list-like block was later emptied, the component had to be switched from
  `{{#list:points}}` to `{{#bool:hasPoints}}` just to avoid empty `<li>`s (issue `11`).

**Suggested fixes**

1. **Fix the documentation** in `format-spec.ts` and `specs/html-engine.md`, distinguishing:
   - *component repetition*: root data file is a sequence, schema is flat, output is one
     wrapper element per item, ids are `<name>-<index>`;
   - *nested list*: `{{#list:name}}` block, `name` is an array inside one instance,
     items are objects accessed via `{{text:field}}`.
2. **Support `"item": {…}`** as sugar: flatten it internally so the intuitive schema validates.
   Today `item` is accepted silently by the parser and then ignored, which is the worst case.
3. **Improve the error**: `(root) must have required property 'benefits'` should read
   *"data file is a map but component uses array repetition: the root must be a YAML sequence"*,
   with the file path. Add an `explain` entry (see issue `13`).
4. **Report a `DATA_KEY_UNUSED` warning** for orphan keys, so a stale
   `data/<page>/<component>.yaml` is visible. Here a leftover `mechanic.yaml` stayed in the
   project for several iterations with no signal at all (the component had been deleted from the
   page, and the warning exists in the catalogue but never fired).

**Workaround used in this build**

Flat schemas + root-level YAML sequences for every repeatable component. Verified working, but
the shape is undocumented in practice.
