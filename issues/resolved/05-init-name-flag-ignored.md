# Issue: `engine init --name "My Project"` ignores the `--name` flag

**Severity**: High  
**Found during**: QA — `engine init --name "Fresh Project"`

**Steps to reproduce**:
1. `engine init --name "My Project"`
2. `cat engine.config.yaml`

**Expected**: `project.name` is `"My Project"`

**Actual**: `project.name` is `"my-project"` (the fallback default)

**Root cause**: `cli.ts` `run()` filters out all `--*` flags except `--page`, `--all`, and `--compact`. The `--name` flag is stripped before `cmdInit` receives it. `cmdInit` correctly looks for `--name` in its args array, but the array no longer contains it.

**Fix**: Add `'--name'` to the keep list in `run()`:  
`const filtered = args.filter(a => !a.startsWith('--') || a === '--page' || a === '--all' || a === '--compact' || a === '--name');`
