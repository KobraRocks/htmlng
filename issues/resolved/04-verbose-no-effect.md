# Issue: `--verbose` flag has no visible effect — no debug output on hot paths

**Severity**: Low  
**Found during**: QA — `engine --verbose render page index`

**Steps to reproduce**:
1. `engine --verbose render page index`

**Expected**: Debug output showing file loading, component parsing, CSS scoping steps.

**Actual**: Same output as without `--verbose`. The `log()` function is defined in `cli.ts` but never called from the hot paths in `renderer.ts`, `component.ts`, `page.ts`, etc.

**Root cause**: The `log()` helper is only accessible within `cli.ts`. Other modules don't import or use it. There are no `log()` calls in `renderPage()`, `parseComponent()`, or any other core module.

**Fix**: Either:
1. Pass a logger function down through the module chain
2. Export `setVerbose`/`log` from a shared module and call it in core modules
3. Or accept that `--verbose` only affects CLI-level logging and add strategic `log()` calls to core modules
