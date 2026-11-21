# Issue: no field-level conditionals — empty strings, dead placeholders and false warnings

**Severity**: Medium (three separate workarounds in one build)
**Found during**: Webinar deck build — hiding one bullet, hiding a block title, flagging the active step
**References**: `src/template.ts:155-158` (`resolveBool` with `data[name] === true`), `specs/html-engine.md`

**Steps to reproduce**:

`{{#bool:x}}` exists as a **block** only. There is no way to render a field conditionally. Three
concrete needs arose in this build:

**(a) Hide one bullet out of three.** The user asked to remove three bullet lines from a card.
With no `{{#if:point1}}`, the only options are an empty string (leaving a stray dash — the `li::before`
marker still renders) or removing the field from the schema. Chosen: add `hasPoints: false` and
wrap the whole `<ul>` in `{{#bool:hasPoints}}`.

**(b) Hide a section title.** The user asked to remove "Vos garanties, en un coup d'œil" above a
strip of numbers. The heading is a schema field (`title`), so hiding it meant:

```
{{#bool:hasTitle}}{{text:title}}{{/bool:hasTitle}}
```
which immediately triggers:
```
WARN  Schema defines "title" but template does not use it.   [SCHEMA_FIELD_UNUSED]
```
because `extractPlaceholders()` (src/validator.ts:84-117) only collects top-level and block names,
**not placeholders nested inside a block**. The only warning-free solution was to **delete the
`title` field and the `<h3>` from the component**, i.e. the component lost a capability because
a conditional cannot be expressed.

**(c) Mark the active item.** A list item needed a different class when it was the "current"
step. `class="{{#bool:isOn}}on{{/bool:isOn}}"` is not a thing, so the workaround was to pass the
**class name as data**:
```yaml
seg1: "on"
seg2: ""
```
```html
<span class="{{text:seg1}}"></span>
```
This works but puts presentation in the content layer, and makes the data file hard to read.

**Suggested fixes**

1. **Add `{{#if:field}}` / `{{#unless:field}}`** — truthiness on the field value (non-empty
   string, non-empty array, `true`). This is the single most valuable addition for authoring:
   it removes all three workarounds above.
   ```html
   {{#if:title}}<h3 class="stats-title">{{text:title}}</h3>{{/if:title}}
   <ul>{{#if:point1}}<li>{{text:point1}}</li>{{/if:point1}}…</ul>
   ```
2. **Make `required` semantics coherent with it**: today `required: true` forbids the empty
   value that a `{{#if}}` would branch on. Suggest `required` = "must appear in the data file"
   and a separate `nonEmpty: true` for "must not be blank", so optional-and-hideable fields are
   expressible without schema surgery.
3. **Fix `extractPlaceholders`** to recurse into blocks (or simply collect every `{{type:name}}`
   occurrence regardless of nesting). The current logic produces systematic false positives for
   every conditional field and pushes authors to delete fields — see also issue `15`.
4. **Consider `{{class:field}}`** or attribute interpolation with an explicit safe type, so
   conditional classes do not need to be smuggled through content data.

**Workarounds applied in this build (all still present)**

- `hasPoints: false` + `{{#bool:hasPoints}}` around a `<ul>`;
- stats title field and `<h3>` removed entirely from the component;
- `seg1/seg2/seg3: "on" | ""` driving CSS class names from YAML;
- `{{#bool:hasTitle}}` removed again after the warning, replacing it with component surgery.
