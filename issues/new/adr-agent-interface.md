# ADR-001: Agent interface — skill-first, CLI-canonical, no MCP, no batch/stdin

> **Status**: Accepted
> **Date**: 2026-07-08
> **Related**: `cli-stack-evaluation.md`, `agent-readiness-and-code-quality-review.md`, `AGENTS.md`, `skill/SKILL.md`

---

## Context

The engine's primary consumer is an AI coding agent. Four interface shapes were on the
table:

1. **Skill + shell-invoked CLI** — prose guidance in context, agent calls the binary.
2. **MCP server** — typed tools in a persistent process.
3. **Batch / stdin mode** — render many items per process from a manifest or pipe.
4. **Library/daemon API** — embed the core in-process.

By the end of Phase D the CLI had already been made agent-native: strict typed argument
parsing (unknown flags rejected), correct exit codes, stable error `code`s, `--json` with
`schemaVersion`, and self-description via `context` / `schema` / `explain`. That changed
the calculus, so this ADR records the resulting interface decision.

## Decision

1. **Skill + CLI is the interface of record.** The skill (`skill/SKILL.md`, `AGENTS.md`)
   carries workflow knowledge; the CLI carries the contract. No MCP server is built.
2. **No batch command and no stdin input format.**
3. **`build` / `diff` stay all-or-one.** Multi-target page selection is **explicitly
   deferred**, not ruled out permanently (see below).
4. If a structured batch interface is ever needed, it belongs in an **in-process adapter**
   (library call or MCP front-end), **not** a CLI wire format.

## Rationale

### 1. A skill is sufficient for shell-capable agents

An agent needs four things to drive a CLI. Only one is a transport concern; the rest are
already provided by the CLI itself:

| Need | Provided by |
|---|---|
| Know the tool exists and how to use it | Skill + `AGENTS.md` |
| Correct invocation (no guessed flags) | CLI: strict parser, unknown flags rejected |
| Reliable result parsing | CLI: `--json` + stable error `code`s |
| Discover project state without guessing | CLI: `context`, `schema`, `explain`, `list` |

The defects fixed in Phases A–D were wrong exit codes, misleading errors, prose-only
output, and undiscoverable features — **none** were "the agent cannot call a binary." A
skill cannot repair a CLI that lies; once the CLI stops lying, a skill is enough.

### 2. No MCP server

An MCP server would add: no shell-string construction, no per-call process startup, and
automatic tool discovery. Against that:

- **Startup is not a bottleneck.** Measured fixed cost is ~35–55 ms per call; a full
  session of 20–50 calls is ~1–6 s. A persistent server saves ~2 s per page.
- **Discovery is shallow.** MCP exposes that a tool exists, not the golden path, the
  invariants, or error-recovery recipes — guidance still ships as a skill.
- **Cost is real**: a process to build, version, keep alive, and debug; a server bug
  becomes an opaque broken tool; and CI/humans still need the CLI, so behavior is
  maintained twice and can drift.
- **Deferring is cheap and reversible.** The core is already a set of pure functions over
  `rootDir` (`renderPage`, `validateComponent`, `loadData`, `buildPages`), so an MCP
  server is a ~150-line adapter, not a rewrite.

### 3. No batch / stdin rendering

**The premise is largely already satisfied** — the missing piece would only be *partial*
batch, which is an optimization rather than a capability:

| Need | Existing primitive |
|---|---|
| Validate everything, aggregate all errors, structured | `validate --json` (all pages **and** components, one process) |
| Produce all output | `build` (wipes and regenerates every page in one process) |
| All HTML for one page | `render page <p> --json` |
| One component across every page | `render component <c> --all` |
| Per-component tight loop | `render component <c> --page <p>` |

**There is no scaling cliff.** Measured on synthetic projects (best of 3; `node` floor
~18 ms):

| Components | `render component c1` | `render page` | `validate` (all) |
|---|---|---|---|
| 25 | 46 ms | 49 ms | 53 ms |
| 100 | 48 ms | 50 ms | 57 ms |
| 300 | 51 ms | 53 ms | 63 ms |

Going from 25 to 300 components costs about **5 ms per call**, even with the eager
full-component load used for `{{slot}}` resolution. Batching would save ~30 ms per call —
roughly one second per session.

**Design cost, and one negative incentive.** Batching pushes agents toward fewer, larger,
less diagnosable steps: change five things, render once, and a failure no longer identifies
which edit caused it. That works against the engine's core promise — component isolation
and the tight `edit → render component → fix` loop. It also forces item-indexed
partial-failure semantics into the `--json` contract (which item failed? what is the exit
code when 3 of 20 fail?), i.e. new permanent surface for an unobserved problem.

**stdin specifically is declined, not merely deprioritized.** A stdin/manifest protocol
reintroduces the exact hazard class Phase A removed: ad-hoc parsing, quoting surprises,
and inputs the typed argument parser cannot validate. Agents have file tools; they do not
need to pipe JSON. Where the input genuinely needs to be structured and large, the right
home is an in-process call, not a CLI wire format.

### 4. Multi-target page selection — deferred sliver

`buildPages(names)` and `affectedPages()` already speak in lists internally, while the CLI
exposes only one page (`build page <p>`). Exposing `build page a b c` is ~30 lines plus
docs. It is deferred because:

- it creates a **third form** of the same command ("all", "one", "several"), which costs
  teachability;
- it saves ~100 ms against a full `build` that is 63 ms at 300 components;
- no observed workflow requires subset builds.

If a concrete manifest-driven subset build appears, this is the first thing to add — and
it would be an argument list, not a batch format.

## Consequences

**Positive**
- One small, teachable surface; one way to do each thing; fewer failure modes.
- The agent contract lives in the CLI and is enforced by tests (`docs.test.ts`,
  `phase-b/c`, `units`), so guidance cannot silently drift.
- The core remains library-shaped, so either adapter (MCP, in-process batch) stays cheap.

**Negative / accepted**
- A genuinely huge site must rebuild fully; full `build` is the only bulk path.
- Harnesses **without shell access** cannot use the engine today. This is the one real
  capability gap and the strongest future argument for an adapter.

## Revisit triggers

Reopen this decision only if one of these becomes true:

1. **A shell-less target harness** must be supported — then build the MCP/in-process
   adapter (the CLI stays canonical).
2. **Measured per-call cost reaches seconds** — not observed up to several hundred
   components.
3. **A concrete workflow needs manifest-driven subset builds** where full `build` is
   demonstrably too slow — then add multi-target arguments, not a batch format.

## Out of scope

- Persistent daemon / HTTP API for humans (`serve` remains a static dev server).
- Spec §11 future items (i18n, `markdown` placeholder, variants) — unrelated to interface.
