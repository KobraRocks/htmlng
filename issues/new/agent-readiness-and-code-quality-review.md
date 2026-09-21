# Agent-Readiness & Code-Quality Review

> **Date**: 2026-07-08
> **Scope**: full repo (17 src modules, 6 test files, specs, SKILL.md, README, issues)
> **Method**: read every source module, ran the suite + typecheck, then reproduced each finding against a real scaffolded project built from `dist/`.
> **Version reviewed**: `html-engine@1.1.0` (branch `production`, HEAD `28722b7`)

---

## 1. Verdict

**Code quality: good. Agent-readiness: mixed.**

The engine is a genuinely well-shaped codebase: 17 flat modules, no framework magic, one error model, deterministic assembly, and a coherent component-isolation story. `npm test` (52/52) and `tsc --noEmit` both pass. The prior `issues/new/code-review.md` cleanup list is essentially resolved (shared `escape.ts`, static imports, `Token` reuse, `text`/`html` merge, js-yaml page rewriting, arg helpers, cached config).

The problem is not style — it is **trust**. An AI agent's entire workflow depends on reading signals from the CLI. Several of those signals are currently **wrong or missing**, and the natural ways an agent writes component files can fail with misleading errors. That is a bigger risk than any code smell, because the agent will confidently ship broken output.

| Dimension | Rating | Notes |
|---|---|---|
| Structure & separation | Strong | Flat, one job per module, no circular deps |
| Type safety | Strong | `strict: true`, clean `tsc --noEmit` |
| Error model | Good | One `EngineError`, `LEVEL [file:field]: message` + `help` |
| Determinism of output | Strong | Pure function of sources (given non-empty data) |
| CLI signal integrity | **Weak** | `validate` exits 0 on failure; `watch` never writes; `build` leaves stale files |
| Input robustness | **Weak** | Empty CSS section, CRLF, missing `href`/`src`, empty array data all break |
| Config honesty | **Weak** | 6 parsed options are never used; 1 implemented option is undocumented |
| Test coverage | Weak | 11/17 modules untested; the 599-line `cli.ts` has **zero** tests |
| Docs / skill | Good but drifting | Strong prose, but feature/command drift and no runnable example |

---

## 2. How it works (map for a new agent)

```
CLI (cli.ts, 599 lines, 14 commands)
  └─ renderer.renderPage()
       ├─ page.ts     parse pages/<p>.page.yaml        (layout only)
       ├─ component.ts parse components/<c>.component.html  (template | CSS | JSON schema)
       ├─ data-file.ts load data/<p>/<c>.yaml          (object OR array → repeated sections)
       ├─ validator.ts schema + text-whitelist + body-structure checks
       ├─ template.ts  {{type:name}}, {{#list}}/{{#bool}}, {{slot}}
       └─ css.ts       scope component CSS under .<name>, prepend global.css, dedupe
  └─ hasher.ts   .engine-cache.json source hashes → "cached"/"rendered" status
  └─ propagation.ts changed file → affected pages (watch/serve)
  └─ copier.ts   assets/ → build/assets/
```

Assembly rules (`renderer.ts:111-132`): first component → `<header>`, last component named `footer` → `<footer>`, everything else → `<section id class>`; a default `<footer>` is appended if the last component is not named `footer`. Array data files repeat a component once per element with indexed IDs.

**Strengths worth preserving:**
- Component isolation is real: editing one component's template/CSS/data cannot structurally affect another.
- `global.css` + `design-tokens.yaml` + per-component override CSS is a clean cascade (C11/C20 in spec).
- Scaffolding (`create component|page|data`, `save ... --as-preset`) is a strong "start from valid skeleton" story.
- Error format and `help` line are agent-friendly in principle.
- All CSS is scope-prefixed and deduped; `@keyframes`/`@font-face` pass through.

---

## 3. Verified defects

Every item below was reproduced. Repro commands assume an empty project built with `htmlng init`; `HE` = `node <repo>/dist/index.js`.

### P0 — the CLI gives the agent a wrong or missing signal

**P0-1 · `validate` prints errors, then says "Validation passed." and exits 0.**
`cli.ts:240-252` catches per-page `EngineError`s, writes them to stderr, then unconditionally writes `Validation passed.` and never sets a failure exit code.

```bash
printf 'heading: 123\n' > data/index/sec.yaml      # schema wants string
htmlng validate
# stderr: ERROR [.../sec.yaml]: Schema validation failed: /heading must be string
# stdout: Validation passed.
# exit:   0        <-- agent believes it succeeded
```
This is the single most dangerous defect: the engine's own safety net reports success on broken input.

**P0-2 · `watch` announces `REBUILT` but never writes `build/`.**
`cli.ts:340-360` renders and prints a diff, but contains no `writeFileSync`. The README calls it "Watch files and rebuild on change".

```bash
rm -rf build && htmlng watch &
printf 'heading: "Changed"\n' > data/index/sec.yaml
# stdout: === REBUILT: index (changed: data/index/sec.yaml)
ls build          # -> No such file or directory
```

**P0-3 · `build/` is never wiped, so deleted/renamed pages keep being served.**
Spec C14 (`specs/html-engine.md:64`) says "The engine always wipes `build/` and regenerates from source". `cmdBuild` (`cli.ts:255-286`) only `mkdirSync`s and writes the pages it iterated.

```bash
htmlng build                      # build/b.html, build/index.html
rm pages/b.page.yaml
htmlng build                      # "Built 1 page(s)"
ls build/*.html                   # build/b.html is STILL there
```

**P0-4 · Missing `href` / `src` crashes with an internal TypeError instead of a schema error.**
`schema.ts:18` validates `image`/`link`/`slot` as bare `type: "object"` — required subfields are unchecked. `template.ts:107,119` then do `escapeAttr(v.src)` / `escapeAttr(v.href)`.

```yaml
# data/index/sec.yaml
cta: { label: "Go" }        # no href
```
```
FATAL: Cannot read properties of undefined (reading 'replace')   # exit 1, no file/field
```

**P0-5 · The component parser rejects the two most natural file shapes.**
`component.ts:16` uses `content.split('\n---\n')`.

```text
(a) Empty CSS section (two consecutive separators) — the obvious way to say "no CSS":
    <h2>{{text:heading}}</h2>
    ---
    ---
    {"heading":{"type":"text"}}
    -> ERROR: Invalid JSON in component schema section      (schema = "---\n{...}")

(b) CRLF line endings (Windows editor / agent on Windows):
    [same file with \r\n]
    -> ERROR: Component file must have at least template and schema sections separated by "---"
```
Workaround is non-obvious: the CSS section must be non-empty (a single space or a `/* */` comment works). The scaffolded template hides this because it always ships a CSS comment.

### P1 — silent wrong behavior, or config/docs that lie

| # | Defect | Evidence | Location |
|---|---|---|---|
| P1-1 | `build <page>` / `diff <page>` silently operate on **all** pages; only `build page <p>` scopes | `htmlng build index` → `Built 2 page(s)`; `htmlng build page index` → `Built 1` | `cli.ts:264,291` |
| P1-2 | Cache ignores `design-tokens.yaml` and `engine.config.yaml`, so `render` reports **`cached (no source changes)`** after a token edit that changes output | edit tokens → `render page index` → `STATUS: cached` | `hasher.ts:104-114`, `renderer.ts:244` |
| P1-3 | `--strict` is a no-op. It only escalates `EngineError` WARNINGs thrown by a handler, which never happens; `validation.strict` is never read | `htmlng --strict render page index` → exit 0, no warnings | `cli.ts:100,119`; `config.ts:79-84` |
| P1-4 | `validatePageData` returns warnings that **every caller discards** → "Unused data key" is dead code; `validateComponent` warnings are discarded during render/build | `validatePageData` return ignored at 3 call sites | `renderer.ts:51,57,172,183`; `validator.ts:130,146` |
| P1-5 | `create data` scaffolds a **wrong stub for `slot`** (`src: null`) and hardcodes list keys `title`/`description` regardless of template fields | `create data slotted` → `widget:\n  src: null` for a `slot` field | `scaffold.ts:181-199` |
| P1-6 | `create component` / `create page` with no name silently create `undefined.component.html` / `undefined.page.yaml` (exit 0); names are unvalidated, so `create component ../../x` escapes the project dir | — | `cli.ts:142,145,149`; `scaffold.ts:145,156` |
| P1-7 | Dead config: `build.minify`, `build.pretty`, `build.assetFingerprinting`, `validation.strict`, `validation.requireAltText`, `validation.maxHeadingLength` are parsed and never used; spec §7.3 promises missing-asset + alt-text validation that doesn't exist | grep confirms zero usages outside `config.ts`/`types.ts`/`scaffold.ts` | `config.ts:71-84`; spec `:758-760` |
| P1-8 | `render component` cannot resolve `{{slot:...}}` to sibling components — it registers only the component under render, so the core per-component feedback loop (C17) breaks for slotted components, with a location-less error | `render component host` → `ERROR []: Slot references unknown component: card` | `renderer.ts:161-162`; `template.ts:172` |
| P1-9 | An array data file that is empty (`[]`) crashes: `renderedComponents` is empty and `lastComp.name` dereferences `undefined` | `FATAL: Cannot read properties of undefined (reading 'name')` | `renderer.ts:127-128` |
| P1-10 | Array data with exactly **one** element omits the `-0` id suffix, contradicting the documented `report-section-0` indexing | `id="sec"` vs `id="sec-0"` for 2+ | `renderer.ts:53` |
| P1-11 | Implemented `build.inlineCSS` is documented **nowhere** in README/SKILL/specs; `htmlng css` is missing from the README command table | grep → 0 hits for `inlineCSS` in docs | README, SKILL |
| P1-12 | `node-html-parser` is imported but unused (`parseHTML` never referenced) yet an entire issue doc is devoted to its bug; the validator is regex-based and no longer checks that sections carry `id`+`class` (spec §7.2) | `validator.ts:1` dead import; `:154-201` regex only | `validator.ts`, `package.json:23` |

### P2 — security, robustness, packaging

| # | Defect | Evidence |
|---|---|---|
| P2-1 | **`serve` path traversal**: with enough `../`, arbitrary files are served | `curl --path-as-is http://localhost:3922/../../../../../../etc/hostname` → `200 kobrarocks-base` |
| P2-2 | `escapeAttr` escapes only `"` — not `&`, `<`, `>`; the `text` whitelist permits `href="javascript:..."` | `escape.ts:6`; `text-validator.ts:8` |
| P2-3 | `{{slot}}` sub-`data` bypasses the `text`-field HTML whitelist (only page data is validated) | `renderer.ts:107-147` never recurses into slot data |
| P2-4 | Build tools shipped as runtime deps (`typescript`, `tsx`, `vitest`, `@types/*`) in `dependencies`; no `engines` field despite a Node ≥22 check in `index.ts:5` | `package.json:16-27` |
| P2-5 | `dist/` is stale (Jul 7) vs `src/`; empty `templates/` dir; `init` never creates `assets/` though README lists it; SKILL.md install path typo `~/Pi/projects/html-htmlng` | `install.sh`, `scaffold.ts:129-143`, `SKILL.md:27` |
| P2-6 | No lint/format config, no CI. `specs/implementation-plan.md:922` calls for `cli.test.ts` — it does not exist | repo root; `test/` |

### Test coverage gaps

6 of 17 modules are tested (`component, css, renderer, template, text-validator, validator`) = 52 tests.
**Untested: `cli` (599 lines — where nearly every P0 lives), `config`, `hasher`, `propagation`, `copier`, `scaffold`, `data-file`, `page`, `schema`, `escape`, `index`.**

---

## 4. Enhancement roadmap — so an agent can master the engine

The goal is not more features; it is to make the CLI a **reliable, machine-checkable feedback loop** and to make the docs impossible to drift.

### Phase A — Restore signal integrity (P0, ~1 day)

1. **Make `validate` a real gate.** Collect *all* errors (don't first-throw), print them, `process.exit(1)` if any ERROR; only print `Validation passed.` when clean. Add `--json`.
2. **Make `watch` build.** Reuse one `buildPages()` helper shared by `build`, `watch`, and `serve --watch` so the three paths cannot diverge again. This also kills the duplicated CSS-rebuild block in `cli.ts` (3 copies).
3. **Wipe `build/` on `build`** per C14 (`rmSync(buildDir, {recursive:true, force:true})`), or add `--clean` and make clean the default.
4. **Validate `image`/`link`/`slot` subfields in the schema layer** (`src`+`alt` for image, `href`+`label` for link, `component` for slot) so P0-4 becomes a friendly `Schema validation failed: /cta must have required property 'href'`.
5. **Harden `parseComponent`**: split on `/^---\s*$/m` line-wise instead of `\n---\n`; normalize CRLF; treat an empty middle section as empty CSS. Add fixtures for both.

### Phase B — Make the CLI agent-shaped (P1, ~2-3 days)

6. **`--json` on `validate`, `render`, `build`, `list`** emitting `{ok, errors:[{code,level,file,field,message,help}]}`. Prose parsing is the main source of agent error; a stable `code` per error also powers `explain`.
7. **Add `htmlng context`** — one call returning the project map: pages → components → data files (present/missing/array), tokens, presets, and per-page staleness. Replaces 5-10 discovery commands an agent currently guesses at.
8. **Add `htmlng explain <error-code>`** with copy-paste fix recipes; generate the catalog from the same table the engine emits, so docs can't drift.
9. **Add `htmlng schema`** emitting JSON Schema for component files, page YAML, and placeholder types — lets an agent self-validate before invoking the engine.
10. **Fix argument handling**: require the literal `page` keyword or accept a bare page name explicitly (`build [page] <p>`), and reject unknown `--flags` instead of silently dropping them. Validate scaffolold names (`^[a-z0-9][a-z0-9-]*$`), and error `--name is required`.
11. **Fix `create data`** for `slot` (`component: ""` + `data:`), and derive list item keys from the template (`{{text:field}}` inside the block), not hardcoded `title`/`description`.
12. **Track `design-tokens.yaml` + `engine.config.yaml` in the cache**, and honor `--strict` by escalating collected warnings. Delete or implement the other dead config keys (`minify`, `pretty`, `assetFingerprinting`, `requireAltText`, `maxHeadingLength`) — an unused option is a lie an agent will act on.
13. **Make `render component` load the full component map** so `{{slot}}` works, and make `preview` generate cross-component sample data.

### Phase C — Agent-facing documentation (parallel, ~1 day)

14. **Add root `AGENTS.md`** (auto-loaded by most agent harnesses) with: the loop, the invariants, the pitfalls list from §3, and a "copy this working example" path. Today the only reference is `SKILL.md`, which is harness-specific.
15. **Ship a runnable `examples/` project** — the 7-component pitch page from the journey logs — committed and asserted by a smoke test. Right now an agent has no golden reference to diff its own output against.
16. **De-duplicate and reconcile docs**: README (command table) ↔ `SKILL.md` ↔ `help()` ↔ spec. Add a trivial conformance test that asserts every command in the README table is a key in `handlers` (`cli.ts:32`). Document `inlineCSS` and `htmlng css`; fix `html-htmlng`.
17. **Add the semantic-authoring + no-wrapper rule to README too**, not just SKILL; implement the validator warning from `issues/new/semantic-html-and-css-inline-evaluation.md` (#3) — it is the one item of that issue still open besides cleanup.

### Phase D — Safety, tests, CI (P2, ~1-2 days)

18. **Fix `serve` traversal**: resolve and assert `resolvedPath.startsWith(buildDir + sep)`; add the missing MIME types; bind `127.0.0.1` by default.
19. **Harden escaping**: `escapeAttr` should escape `&`, `<`, `>`, `"`; reject `javascript:`/`data:` in `href`; validate `slot.data` through the same `text` whitelist.
20. **Move `typescript`/`tsx`/`vitest`/`@types/*` to `devDependencies`; add `engines.node`; drop `node-html-parser`** (unused) and close `issues/new/06-node-html-parser-body-bug.md`.
21. **Add `test/cli.test.ts`** covering exit codes and stdout/stderr for every command — the regression net for Phase A/B. Then add tests for `config`, `hasher`, `propagation`, `scaffold`, `data-file`, `page`, `schema`.
22. **Add CI** (`typecheck` + `test` + a build smoke test) and a formatter/linter so contributed code stays uniform.

---

## 5. How an agent should operate the engine *today* (interim playbook)

Until the P0s land, these rules avoid every trap above:

- **Never trust `validate`'s exit code.** Run `render page <p>` (it throws and exits 1) instead, or grep stderr for `ERROR`.
- **Use `build page <p>`** with the literal `page` keyword; never `build <p>`.
- **Use `serve --watch`** for live rebuilds; `watch` does not write output.
- **Write component files with LF endings**, and give the CSS section at least a space or comment — never two consecutive `---`.
- **Always supply `href` for `link`, `src` for `image`.**
- **Never ship an empty (`[]`) array data file.**
- **Don't rely on `{{slot}}` with `render component`/`preview`** — render the whole page instead.
- **Delete `build/` manually** when you rename/remove a page.
- **Re-run `build` after editing `design-tokens.yaml`** — the cache won't flag it as stale.
- **Verify AI-authored components have no outer `<div class="<name>">`** — the engine already emits the wrapper.

---

## 6. Suggested acceptance tests for the fixes

| Fix | Test assertion |
|---|---|
| P0-1 | `run(['validate'])` on a project with a bad data file → exit code 1, stdout does **not** contain "passed" |
| P0-2 | `watch` rebuild writes `build/<p>.html`; content matches `render page` |
| P0-3 | build 2 pages, delete one YAML, rebuild → `build/<deleted>.html` absent |
| P0-4 | data `{label}` only → `EngineError` naming `href`, no TypeError |
| P0-5 | fixtures: empty CSS section, CRLF file, whitespace-padded separators all parse |
| P1-1 | `build` with an explicit page arg builds exactly that page |
| P1-2 | edit tokens → `isStale(root,'index') === true` |
| P1-6 | `create component` with no name → exit 1, no `undefined.component.html` |
| P2-1 | `GET /../../../../etc/hostname` → 404 |

---

## 7. Open questions

1. Should `build` wipe `build/` by default (spec C14) or gain a `--clean` flag? Wiping is safer for agents but destroys the `diff` baseline if the cache is missing.
2. Is `htmlng watch` intended to be read-only (diff-only) and simply mis-documented, or is it a bug for not writing? Either way one of code/docs must change.
3. Should `--strict` escalate validator warnings (schema unused, data unused keys) to errors, or should those become errors unconditionally once they're actually surfaced?
4. Is `htmlng serve` meant only for `localhost`? If it can bind a network interface, P2-1 becomes high severity, not low.

---

## 8. Implementation status (updated 2026-07-08)

Phase A + the stack trim from `cli-stack-evaluation.md` are done. Tests: **88 passing** (was 52), `tsc --noEmit` clean.

| ID | Status | Change |
|---|---|---|
| P0-1 | ✅ Fixed | `validate` aggregates errors, exits 1, never prints "passed" on failure; `--strict` fails on warnings |
| P0-2 | ✅ Fixed | `watch` now writes `build/` via the shared `buildPages()` |
| P0-3 | ✅ Fixed | full `build` wipes `build/` (C14); targeted `build <p>` leaves other pages |
| P0-4 | ✅ Fixed | `ajv` replaced by `src/schema.ts`; `image.src`, `link.href`/`label`, `slot.component` now required, friendly errors |
| P0-5 | ✅ Fixed | `parseComponent` splits line-wise; empty CSS section, CRLF, padded separators, BOM, trailing separator all parse |
| P1-1 | ✅ Fixed | one-pass typed arg parser; `build <p>` and `build page <p>` both target one page; unknown flags rejected |
| P1-6 | ✅ Fixed | `create` requires a valid name (`undefined.*` and path traversal rejected) |
| P1-9 | ✅ Fixed | empty array data renders instead of crashing on `lastComp.name` |
| P2-1 | ✅ Fixed | `serve` confines requests to `build/` (403 on traversal); MIME table extended |
| P2-4 | ✅ Fixed | build tools moved to `devDependencies`; `engines.node >= 22`; `node-html-parser` + `ajv` removed |
| — | ✅ Extra | footer-collision fix: a `footer` component that is not last no longer produces a duplicate `id="footer"`; `EPIPE` on piping to `head`/`grep` exits quietly instead of crashing |
| P1-2 | ⬜ Open | cache still ignores `design-tokens.yaml` / `engine.config.yaml` (Phase B) |
| P1-3 | 🟡 Partial | `--strict` now affects `validate` warnings; render/build warnings still discarded (Phase B) |
| P1-4 | ⬜ Open | `validatePageData` warnings still not surfaced during render/build (Phase B) |
| P1-5 | ⬜ Open | `create data` still emits `src: null` for `slot`, hardcodes list keys (Phase B) |
| P1-7 | ⬜ Open | dead config keys (`minify`, `pretty`, `assetFingerprinting`, `requireAltText`, `maxHeadingLength`) (Phase B) |
| P1-8 | ⬜ Open | `render component` still can't resolve `{{slot}}` to siblings (Phase B) |
| P1-10 | ⬜ Open | single-element array data still omits the `-0` id suffix (Phase B) |
| P1-11 | 🟡 Partial | `inlineCSS` documented in README; `htmlng css` added to README table |
| P1-12 | ✅ Fixed | unused `node-html-parser` import + dependency removed |
| P2-2, P2-3, P2-5, P2-6 | ⬜ Open | escaping hardening, slot-data whitelist, packaging, CI (Phase C/D) |

