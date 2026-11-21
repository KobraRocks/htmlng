# Coding standards

The judgement calls a reviewer must enforce in this repository. The global
`coding` skill is the authoritative contract for everything else — read it before
changing code. This page records only the calls that are easy to get wrong here.

Mechanical limits (file size, relative import depth, module docblocks) are not
repeated here: #14 adds `test/architecture.test.ts` to assert them, and this page
must not duplicate what a test can check.

## Module boundaries

- One module, one responsibility you can state in a sentence without "and".
  `src/` is flat; new behavior belongs in the module that already owns that
  responsibility, or in a new single-purpose module when no owner exists.
- Dependencies point inward. Leaf modules (`types.ts`, `escape.ts`,
  `error-catalog.ts`) import nothing; parsers and validators must never import
  `renderer.ts` or `cli.ts`.
- The CLI owns argument parsing and I/O. Policy shared by commands lives outside
  it. Diagnostics de-duplication, orphan warnings, and page attribution belong to
  `diagnostics.ts`, not to whichever command happens to need them.
- Callers own output. A policy module builds and filters values; it does not print.

## Public surface

- Export only what a second caller needs. Start private; widen when a real caller
  appears, not in anticipation of one.
- Shared types belong in the module that owns the concept (`types.ts` for engine
  types), never re-declared in the caller.
- Do not add a parameter or option that no current caller sets.

## Comment and doc accuracy

- A module docblock states what the module does **and who calls it**. A wrong
  caller is a bug: `src/diagnostics.ts` claimed it was shared by "every command"
  when only the CLI and renderer used it (#18). Moving a caller means updating the
  docblock in the same change.
- Document contracts — inputs, errors, side effects — not line-by-line behavior.
- If a rename removes the need for the comment, rename instead.

## Test seams

- Test public behavior through a module's exported surface. A private helper that
  needs its own coverage is a signal it belongs in its own module, as the
  diagnostics helpers did when #11 moved them out of the CLI.
- Assert exit codes and rendered output at the CLI boundary; assert diagnostic
  codes, not prose.
- Fixtures stay minimal and deterministic: no wall-clock, network, or
  machine-specific paths.
- A bug fix includes the regression test that would have caught it.

## Review ask

From the diff alone, a reviewer must be able to name the module that owns the
change, who calls it, which test covers it, and what could break. If the diff
cannot answer those, ask for a split rather than approve it.
