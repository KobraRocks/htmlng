# Issue: `htmlng` `context` fails with `ctx.shell.run is not a function`

**Severity**: High (blocks the documented golden path)
**Found during**: Webinar deck build (4 slides, fixed 1920×1080 format), first tool call
**Environment**: DSH harness, html-engine checkout `/home/kobrarocks/.npm/_npx/1e7f6d9597241db0/`, engine `dist/index.js` v1.1.0
**Status**: suspected to be **harness-side**, not an engine bug — see "Diagnosis" below

**Steps to reproduce**:
1. From an agent session, invoke the `htmlng` tool with `command: "context"` (any workdir).
2. Same result with `command: "schema"` or any other argument.

**Expected**: the project map as JSON, per the `html-engine` skill's golden path
(`1. context - project map: pages, components, data, tokens, staleness (JSON)`).

**Actual**:
```
Error: ctx.shell.run is not a function
```
and **no other output, no stack, no error code**. The tool returns the error as its result, so
there is nothing to distinguish "engine failed" from "tool plumbing failed".

**Diagnosis — why this is probably the harness, not the engine**

The second argument supplied to the tool call is a **string**, not an object:

```json
{ "command": "context", "workdir": "site" }
```

The wrapper then calls `ctx.shell.run(...)`. `shell.run is not a function` means the harness
did not inject a `shell` object with a `run` method (or injected a different shape). Nothing in
the engine can produce that message: the engine's own failure path is `EngineError` with a
stable `code` (see `src/error-catalog.ts`).

**What was done instead**: the CLI was driven directly for the whole session:

```bash
node /home/kobrarocks/Pi/projects/html-engine/dist/index.js context --json
node /home/kobrarocks/Pi/projects/html-engine/dist/index.js validate --json
```

This worked perfectly (see the positive note in `08-…`), so **no engine functionality was lost**
— only the documented interface was.

**Suggested fixes**

1. **Harness**: repair the `htmlng` tool binding so `ctx.shell.run` exists, or execute the CLI
   via the harness's process primitive (`child_process.execFile` with `node <engine> <args>`).
2. **Harness**: when a tool's plumbing throws, return a distinguishable error (e.g.
   `{ ok:false, layer:"tool", error:"..." }`) instead of a bare `TypeError` string. An agent
   cannot tell whether to retry, change arguments, or fall back.
3. **Skill**: add one line to the `html-engine` skill documenting the CLI fallback and the
   engine path, so an agent hitting this failure has a one-step recovery instead of guessing:

   > If the `htmlng` tool is unavailable, run the engine directly:
   > `node <engine-checkout>/dist/index.js <command>` with the project as cwd.

**Note on sandbox**: this was first suspected to be a sandbox restriction. The session was
later granted full file access and **the failure did not change**, which confirms it is not a
filesystem permission problem.
