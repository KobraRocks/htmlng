# Architecture guardrails: module docblocks, import depth, and a one-file size ratchet

The `coding` skill supplied the 700-line file cap that #14 was written against; it is no longer installed, and a universal line cap measures implementation size rather than interface depth. We enforce three mechanical checks instead: every `src/**/*.ts` starts with a module docblock, relative imports may not traverse two or more parent directories (`../../`), and `src/cli.ts` is ratcheted at its exact line count in `test/architecture-baseline.json`. New modules are not size-checked. The ratchet keeps the one known oversized module visible without shaping every future module around an arbitrary number; its split is tracked in #19.

## Consequences

- `src/cli.ts` may not grow. A change that adds lines must extract at least as many, and a shrink requires lowering `test/architecture-baseline.json` in the same change.
- The baseline is review-enforced. The test reads the JSON, not who edited it, so raising or removing an entry is a review-blocking change.
- New files are not size-checked. A new monolith would pass the suite; review is the backstop, and #19 carries "no new module over ~700 lines" as an acceptance criterion.
- `test/architecture.test.ts` self-tests each checker against synthetic input, so a broken regex or line counter fails the suite instead of silently passing.

## Considered options

- **Universal 700-line cap.** Rejected: the number was arbitrary once the coding skill was removed, and a hard cap rewards shallow extraction — pass-through modules and `utils.ts` grab bags that cost an agent more context than the file they replace.
- **Soft budget / warning.** Rejected: a CI warning is ignored; only the ratchet needs to fail.
- **Drop file-size checking.** Rejected: it loses the `cli.ts` signal entirely.
