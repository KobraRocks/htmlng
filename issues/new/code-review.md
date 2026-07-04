# Code Review: Overengineering & AI Maintainability

> **Date**: 2026-07-04  
> **Verdict**: Minor overengineering. AI-maintainable with a few cleanups.

---

## What's good

- **Flat module structure**: 17 files, one directory. No deep nesting. An AI can find any module by name.
- **Explicit error handling**: `EngineError` thrown, caught once at CLI boundary. No mixed patterns.
- **Clear separation**: template engine, CSS scoping, validation, rendering — each module does one thing.
- **Types in one file**: `types.ts` has everything. No cross-file type imports.
- **No frameworks**: CLI is a `Map<string, fn>`. CSS scoping is string manipulation. Template engine is a hand-rolled parser. Zero magic.

---

## Issues found

### 1. DRY: `escapeHtml`/`escapeAttr` duplicated in `template.ts` and `renderer.ts`

Two identical functions in two files. An AI fixing a bug in one copy will forget the other.

**Fix**: Extract to a shared `src/escape.ts` (or put in `types.ts` since they're small utilities).

### 2. DRY: `text` and `html` cases in `resolveInline` are identical

```typescript
case 'text': {
  const v = data[name];
  return v !== undefined && v !== null ? String(v) : '';
}
case 'html': {
  const v = data[name];
  return v !== undefined && v !== null ? String(v) : '';
}
```

Both do the same thing. The difference between `text` and `html` is handled at validation time, not render time.

**Fix**: Merge into one case: `case 'text': case 'html':`

### 3. Token type defined but not reused in function signatures

`template.ts` defines a clean `Token` type but then `walk()`, `resolveList()`, and `resolveBool()` redeclare the same complex inline type `Array<{ kind: string; value?: string; type?: string; name?: string }>`. This is repeated 3 times.

**Fix**: Export the `Token` type and reuse it. Or use the typed union defined at the top.

### 4. `readFileSync` imported twice in `cli.ts`

```typescript
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';  // line 1
// ...
import { readFileSync } from 'node:fs';  // line 20
```

Just merge into the first import. Confusing for an AI scanning imports.

### 5. Dynamic imports when static would work

`cli.ts` uses `await import('./page.js')` in 4 different handlers. These modules are always needed — the CLI can't run without them. Dynamic imports add async overhead and cognitive load for zero benefit.

**Fix**: Move to static imports at the top.

### 6. `loadConfig(ROOT)` called twice in `cmdBuild` loop

```typescript
for (const p of pages) {
  const html = renderPage(ROOT, p);
  // ...
  const config = loadConfig(ROOT);  // called again inside loop!
```

`loadConfig` reads and parses a YAML file. Calling it inside the loop is wasteful. The config was already loaded at the top of the function but scoped inside the `for` block.

**Fix**: Load once before the loop, reuse.

### 7. `pageName` parameter threaded through `template.ts` but unused

`renderTemplate` accepts `pageName: string` and passes it through `walk()` → `resolveInline()` → `resolveSlot()`. It's never used for anything — error messages don't include it, slot resolution doesn't use it to look up data files (slot data is inline).

**Fix**: Remove the `pageName` parameter from `renderTemplate` and all internal functions.

### 8. `cmdAdd` rewrites YAML with regex

```typescript
content.replace(/components:\s*(\[[\s\S]*?\]|(\n\s*-.*)+)/, ...)
```

This regex manipulates YAML as a string. It works for simple cases but will corrupt the file if the user has comments, blank lines between list items, or multi-line values.

**Fix**: Use `js-yaml` to parse the page YAML, modify the array, and re-serialize. `js-yaml` is already a dependency.

### 9. Ad-hoc arg parsing duplicated across handlers

Every handler manually does `args.indexOf('--page')`, `args[1]`, etc. This is simple but repetitive. An AI adding a new command will copy-paste the pattern and potentially introduce bugs.

**Fix (optional)**: Extract a small helper:
```typescript
function flag(args: string[], name: string): string | null { ... }
function positional(args: string[], index: number): string | null { ... }
```

---

## Recommendations

| Priority | Fix | Effort |
|----------|-----|--------|
| **High** | Extract shared `escapeHtml`/`escapeAttr` | 5 min |
| **High** | Remove `pageName` from template.ts | 5 min |
| **Medium** | Merge duplicate `readFileSync` import | 1 min |
| **Medium** | Static imports instead of dynamic in cli.ts | 5 min |
| **Medium** | Cache `loadConfig` in cmdBuild loop | 1 min |
| **Medium** | Use js-yaml for cmdAdd page rewriting | 10 min |
| **Low** | Merge `text`/`html` cases in template.ts | 1 min |
| **Low** | Reuse Token type in function signatures | 5 min |

**Bottom line**: Not overengineered. Minor cleanup would make it excellent for AI maintenance. The core patterns are sound — flat structure, explicit errors, no magic. The issues are mostly copy-paste artifacts from rapid implementation.
