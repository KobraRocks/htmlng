# Issue: quick wins — list-element validation index, false-positive warnings, `explain` gaps, cache message

**Severity**: Low-Medium (each cost at least one iteration; all are small, well-scoped fixes)
**Found during**: Webinar deck build (4 slides, ~40 validation runs)
**References**: `src/validator.ts`, `src/error-catalog.ts`, `src/cli.ts` (render), `src/data-file.ts`

Each item below is independent and small. Ordered by value for an agent loop.

---

## 1. List validation errors do not identify the element

**Repro**: a data file with six elements where two exceed `maxLength`:

```
ERROR [/…/data/slide-3/sales-step-4.yaml] Schema validation failed:
      /body must NOT have more than 210 characters
```

The message names the **field** but not the **element index**, and ajv reports errors per file,
so with `sales-step-1…6.yaml` there is no way to tell which file/item is wrong without opening
them. When the same component repeats (6 rows), the fix was manual bisection.

**Proposal**: prefix the path with the element index and the component id
(`element [3] (/body): …`, `component: sales-step-4`), or log one error per file with the id.

---

## 2. `SCHEMA_FIELD_UNUSED` false positives for placeholders inside blocks

`extractPlaceholders()` (`src/validator.ts:84-117`) deliberately excludes names inside blocks
("Only collect top-level names and block names"). Any placeholder used inside `{{#bool:…}}` or
`{{#list:…}}` therefore produces:

```
WARN  Schema defines "numero" but template does not use it.
```

Observed for `numero` (inside `{{#bool:isOn}}`), `this` (inside a conditional `<ul>`) and
`title` (inside `{{#bool:hasTitle}}`). Effects: warning noise that hides real warnings, and a
push toward **deleting schema fields** to silence it (see issue `14`).

**Proposal**: recurse into blocks when collecting used names, or drop the fallback and rely on a
whitelist of "known unused" cases. A warning must never be wrong, or agents learn to ignore it.

---

## 3. `DATA_KEY_UNUSED` does not fire for orphan data files

A `data/slide-2/mechanic.yaml` survived several iterations after its component was removed from
the page. No warning, no error, and the file became an invisible trap: reintroducing a
`mechanic` component later would silently pick up stale content.

**Proposal**: warn for data files whose component is not referenced by the page
(`DATA_FILE_ORPHAN`), and for keys present in the data but absent from the schema (the
catalogue already lists `DATA_KEY_UNUSED` — it did not trigger here).

---

## 4. `explain` is missing the codes an author hits most

`node dist/index.js explain` lists ~25 codes. Absent from the list while being the most
frequently triggered messages in this build:

| Code | Triggered by |
| --- | --- |
| `PAGE_BODY_CHILD` | `<script>` at the end of `<body>` (issue `13`) |
| `SCHEMA_FIELD_UNUSED` | conditional placeholders (issue `14`) |
| `DATA_KEY_UNUSED` | orphan YAML keys |
| `SCHEMA_VALIDATION` | the generic catch-all — the one that needs the best explanation |

**Proposal**: generate `explain` from the same table the validator uses, and make it exhaustive
by construction (a test that every code thrown in a `src/**` has a catalogue entry would keep
this honest).

---

## 5. `render component` reports `STATUS: cached` after an edit

```
$ node dist/index.js render component header --page slide-1
=== STATUS: cached (no source changes)
<img class="bar-logo" src="…">      # ← actually the NEW output
```

The body is current, so the label is misleading: it suggests the file was *not* re-read, while
the subsequent `build` picks up changes. Debugging a stale-looking rule, this message sent me
looking for a caching problem that did not exist.

**Proposal**: either drop the status line for read-only render commands, or report
`source hash unchanged since last render` only when true, and never on the first render after an
edit.

---

## 6. Minor: no `--out` for `build`, and `paths.build` must be a single path segment

`config.ts:71` accepts `paths.build` but `CLI` rejects values containing `/` or `..`
(`CONFIG_PATH_TRAVERSAL`), and `build` wipes its output directory when building all pages
(`cli.ts:524`). Practical consequence: the engine cannot write into a shared `dist/` tree
(`dist/deck/`, `dist/docs/`), which forces the project to be an isolated directory. Acceptable
as a constraint, but worth documenting — I had to restructure the delivery folder around it.
