# CLI Stack Evaluation — Is TypeScript/Node the Right Choice for an AI Agent?

> **Date**: 2026-07-08
> **Question**: before implementing the agent-readiness roadmap, is the CLI tech stack itself right — for **performance** and for **agent ergonomics**?
> **Method**: measured cold-start latency, dependency cost, dev vs built path, and scaling on synthetic projects. Node v24.20.0, this machine, best-of-N.
> **Companion**: `issues/new/agent-readiness-and-code-quality-review.md`

---

## Verdict

**Keep TypeScript/Node. Performance is a non-issue. Ergonomics is an interface problem, not a language problem.**

A rewrite (Go/Rust) would save ~50 ms per invocation — invisible next to LLM turn latency. The real agent-ergonomics defects come from how the CLI is *shaped* (hand-rolled arg parsing, prose-only output, `process.exit` inside handlers), not from the runtime. Two dependencies should be dropped, and one structural refactor (parse args once, return results) should precede the feature roadmap because it makes every Phase A/B fix cheaper.

---

## 1. Measured performance

### Fixed cost dominates every command

| Command | Latency |
|---|---|
| bare `node -e ''` | **17 ms** |
| `htmlng --help` (loads `js-yaml` + `ajv` + `diff` + module graph) | **55 ms** |
| `render page index` (3 components) | 56 ms |
| `list components` | 55 ms |

The command's work is negligible; **~38 ms is fixed startup**, and 25 ms of that is dependency import.

### Dependency budget (marginal import cost over bare node)

| Import | Latency | Δ |
|---|---|---|
| `js-yaml` | 20 ms | +3 ms |
| `diff` | 23 ms | +6 ms |
| **`ajv`** | **37 ms** | **+20 ms** |
| `chokidar` (dynamic — not on the `render`/`validate` path) | 22 ms | +5 ms |
| `js-yaml` + `ajv` + `diff` (the static CLI set) | 42 ms | +25 ms |

**`ajv` alone is over half the dependency startup cost (20 of 38 ms).**

### Scaling is linear and cheap

| Workload | Latency |
|---|---|
| `render page` — 10 components | 90 ms |
| `render page` — 30 components | 104 ms |
| `validate` — 6 pages × 10 components (60 component renders) | 122 ms |
| `build` — 6 pages (HTML + CSS) | 131 ms |

Marginal cost ≈ 1.5–3.5 ms per component. There is no O(n²) behavior at these sizes.

### Dev vs built path

| Path | Latency |
|---|---|
| `node dist/index.js --help` | 55 ms |
| `npx tsx src/index.ts --help` | **397 ms** (7×) |
| `npm run build` (tsc) | 847 ms |

### Why this rules out a rewrite

An agent building one page makes roughly 20–50 CLI calls. At 55–130 ms each, total shell time is **~1–6 seconds per page** — lost in the noise of model latency (seconds to minutes per turn). A Go/Rust binary would cut the fixed cost to ~5 ms, saving **~2 s per page**. That does not justify abandoning:
- the strict-TypeScript types and the 52-test vitest suite,
- the stack spec's explicit rationale (`specs/stack.md:22`) that dependencies were chosen for AI training-data familiarity,
- the flat 17-module structure an agent can navigate by filename.

**Reject Go/Rust. Reject Python (worse startup, weaker typing). Bun/Deno (native TS, ~10 ms start) would fix the `tsx` gap but is a runtime migration that buys nothing measurable today — revisit only if startup ever becomes visible.**

---

## 2. Three concrete stack inefficiencies (fixable without a rewrite)

### 2.1 `ajv` is the wrong dependency — drop it

`ajv` is used in exactly one 42-line file (`src/schema.ts`) to support a **tiny, non-standard subset**: `type` (string/boolean/object/array), `required`, `maxLength`, and `additionalProperties: true`.

It costs:
- **+20 ms per invocation** (36% of total fixed startup, over half the dep budget),
- the largest install of the five production deps,
- and it *cannot express* the engine's real schema — `image`/`link`/`slot` are validated as bare `type: "object"`, which is the root cause of defect **P0-4** (missing `href`/`src` → `FATAL: Cannot read properties of undefined (reading 'replace')`).

A ~50-line hand-written validator for this dialect would:
- remove the dependency and ~20 ms,
- **add the subfield checks ajv can't do** (`src`+`alt` for image, `href`+`label` for link, `component` for slot) — turning P0-4 into a friendly `Schema validation failed: /cta must have required property 'href'`,
- keep the "no magic, AI-readable" philosophy the stack spec already commits to.

### 2.2 `node-html-parser` is a dead dependency — drop it

`src/validator.ts:1` imports `parse as parseHTML`; it is **never referenced** (validation was rewritten to regex after `issues/new/06-node-html-parser-body-bug.md`). It is nonetheless still listed as a production dependency in `package.json:23` and in `specs/stack.md` §2.1, and §8#7 still claims it will power "HTML-aware diff".

Keeping a dead parser dependency is worse than neutral: it keeps the parser-bug issue nominally "open", and it misleads an agent reading the stack spec into thinking templates are DOM-validated.

### 2.3 Dependency hygiene

- `typescript`, `tsx`, `vitest`, `@types/node`, `@types/js-yaml` are in `dependencies` (`package.json:16-27`) — they are build/test tools and belong in `devDependencies`. They currently ship to every consumer.
- No `engines` field, despite a hard Node ≥22 check in `src/index.ts:5`.
- `tsx` at 397 ms makes the documented dev loop (`npm run dev`, or `npx tsc` per `SKILL.md:27`) 7× slower than the built path. Recommend: agents run the built CLI; add a `dev:build --watch` (tsc `--watch`) so source edits trigger a fast rebuild instead of a 400 ms re-transpile per call.

**Net effect of 2.1–2.3: 5 production deps → 3 (`js-yaml`, `chokidar`, `diff`), fixed startup 55 ms → ~35 ms, and real subfield validation becomes possible.**

---

## 3. Ergonomics: the stack is fine, the interface shape is not

The agent-painful defects in the companion review are **interface-level**, and none of them require changing language or runtime:

| Symptom | Root cause in the current shape | Fix (no stack change) |
|---|---|---|
| `build index` silently builds *all* pages (P1-1); unknown `--flags` silently dropped | Every handler does its own `args.indexOf`/`args[1]` after a lossy `filter()` (`cli.ts:103-104, 264, 291`) | Parse once into a typed `{command, subcommand, positionals, flags}`; reject unknown flags. ~30 lines; a framework is not needed |
| Agent must regex prose stderr (all P0 items) | Output is human-only; no machine contract | `--json` with a stable `code` per error; keep human output as default |
| CLI is untestable; `cli.test.ts` absent | `process.exit()` called inside handlers (`cli.ts:110,120,123,154,183,370,402,529,543,551,555,569`) | Handlers return a `{stdout, stderr, exitCode}` result; exit only at the `run()` boundary |
| 30 calls × full re-parse of config + all components | One-shot process, no shared context | Accept it (55 ms × 30 ≈ 1.6 s, invisible) **or** add a long-running `serve --api`/MCP front-end later |
| N components → N processes | No batch mode | `render --all --json` / stdin manifest. Low priority given the speed |

**MCP is the one genuinely better agent interface** — a persistent server exposing `render`, `validate`, `context`, `build` as typed tools would eliminate per-call startup, give structured results for free, and remove the shell-string-parsing failure mode entirely. But it is an **addition**, not a replacement: the CLI must remain for humans, CI, and simple harnesses. Recommend scheduling it after Phases A–C, not before.

> **Decided 2026-07-08 (see `adr-agent-interface.md`)**: after Phases A–D made the CLI
> agent-native, the measured case for a persistent server did not hold (startup ~35–55 ms;
> ~5 ms growth from 25 → 300 components). **MCP is deferred**, not adopted — the CLI is the
> interface of record, and a shell-less harness is the trigger that would change this.

---

## 4. Recommendation (revised sequencing)

Keep TS/Node and the flat architecture. Change only the order of work:

1. **Stack trim first** — drop `ajv` and `node-html-parser`, move build tools to `devDependencies`, add `engines`, replace `schema.ts` with the ~50-line typed validator that checks subfields. *This is a prerequisite, not a cleanup: it removes the cause of P0-4 and cuts 20 ms per call.*
2. **Parse-once CLI refactor** — typed `{command, subcommand, positionals, flags}`, reject unknowns, return results, `process.exit` only at the boundary. *This makes `cli.test.ts` possible and eliminates the P1-1/P1-6 class.*
3. **Then** run the companion roadmap: Phase A (trust signals: `validate` exit code, shared `buildPages()`, build wipe, robust component parsing), Phase B (`--json`, `context`, `explain`, `schema`), Phase C (`AGENTS.md`, examples, doc conformance).
4. **Later, optional** — `serve --api` / MCP front-end reusing the same core modules.
   **Deferred per `adr-agent-interface.md`**; the same ADR also declines batch/stdin
   rendering and defers multi-target `build page a b c`.

### What would change this verdict

- If the engine grew CPU-bound work (HTML minification, image processing, markdown for hundreds of pages, fingerprinted asset pipelines), revisit a compiled runtime.
- If agents were expected to call the CLI **thousands** of times per session (e.g., a tight per-field edit loop), the fixed 55 ms and the one-shot re-parse would start to matter — then a persistent MCP/API server (not a rewrite) is the answer.
- If distribution to non-Node users became a requirement, a single binary becomes attractive — but that is a packaging problem (e.g., `bun build --compile` or `pkg`), not an architecture problem.
