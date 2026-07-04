# Issue: scaffoldData generates null for text fields, causing schema validation errors

**Severity**: Medium  
**Found during**: QA — `create data hero --page index` then `render page index`

**Steps to reproduce**:
1. `engine create component hero`
2. `engine create data hero --page index`
3. `engine render page index`

**Expected**: Data file renders with empty/default values, no errors.

**Actual**: `ERROR: Schema validation failed: /body must be string`

**Root cause**: `scaffold.ts` `scaffoldData()` generates `null` for text/html fields. The component schema says these are type `"text"` (string). ajv rejects `null` as not a string.

**Files affected**: `src/scaffold.ts` — the `scaffoldData` function

**Fix**: Generate empty string `""` for text/html fields instead of `null`. For optional fields, the schema has `required: false` so empty string is valid.
