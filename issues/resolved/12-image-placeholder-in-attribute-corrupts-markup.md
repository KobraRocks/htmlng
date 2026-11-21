# Issue: `{{image:x}}` inside an attribute value corrupts the markup, silently

**Severity**: Medium-High (produces broken HTML with `validate: ok`)
**Found during**: Webinar deck build — header logo, footer logo
**References**: `src/template.ts:104-114` (inline `image` resolution)

**Steps to reproduce**:

1. Write the natural markup for an image with a custom alt:
   ```html
   <img class="bar-logo" src="{{image:logo}}" alt="{{text:logoAlt}}">
   ```
   with data:
   ```yaml
   logo:
     src: "../assets/logo.png"
     alt: "Silar Vatouva"
   logoAlt: "Silar Vatouva — l'art du service au service de l'art"
   ```

2. `node dist/index.js build`

**Expected**: `<img class="bar-logo" src="../assets/logo.png" alt="…">`

**Actual** — the placeholder is replaced by a **complete `<img>` tag**, so the tag lands inside
the attribute:

```html
<img class="bar-logo" src="<img src="../assets/logo.png" alt="Silar Vatouva">" alt="Silar Vatouva — l'art du service au service de l'art">
```

Rendered result: a **broken image**, with the literal string `<img src=…>` printed as the alt
text (visible in the page, and again in the PDF). `validate` reports **ok, 0 errors, 0 warnings**
— this shipped into two builds before being caught visually.

**Root cause**

`{{image:name}}` is an *element* placeholder: `template.ts:104` builds the whole `<img …>` tag
from the data object (`src`, `alt`, `width`, `height`, `loading`, `class`). There is therefore no
way to use it as an attribute value, and no way to override the alt — the alt must come from the
data object. Documented `placeholderTypes.image` says `dataShape: { src, alt, … }` but does not
say "emits a whole element, cannot be used inside an attribute".

**Suggested fixes**

1. **Detect it and fail loudly**: when a `{{image:…}}` placeholder appears inside a quoted
   attribute value, raise `COMPONENT_PLACEHOLDER_IN_ATTRIBUTE` (the tokenizer already has
   positions; this is a cheap check in `validateComponent`).
2. **Document the two valid forms** in the skill and in `schema`:
   ```html
   {{image:logo}}                              <!-- emits <img src alt> -->
   <span class="logo">{{image:logo}}</span>     <!-- to style the box -->
   ```
3. **Add a scalar variant** for attribute use, e.g. `src="{{url:logo}}"` emitting only the
   escaped URL, or support `{{image:logo.src}}` / `{{image:logo.alt}}` field access (see
   issue `15`).
4. While here: today the only way to give a custom alt is the data object. That is fine, but it
   forces a **duplicated key** whenever the alt is also displayed or used elsewhere — the
   `logoAlt` text key existed only to feed a `text` placeholder that could not be used.

**Workaround used in this build**

```html
<span class="bar-logo">{{image:logo}}</span>
```
with `.bar-logo img { width: 15.6vw }` in the component CSS. The `logoAlt` key became unused and
had to be removed from the schema to silence `SCHEMA_FIELD_UNUSED` (see issue `13`).
