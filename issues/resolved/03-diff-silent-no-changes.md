# Issue: `engine diff` produces no output when there are no changes

**Severity**: Low (UX)  
**Found during**: QA — `engine diff` after build with no modifications

**Steps to reproduce**:
1. `engine build`
2. `engine diff`

**Expected**: Message like "No changes detected" or "All pages up to date."

**Actual**: Silent exit 0 with no output. User has no way to distinguish "diff ran and found nothing" from "diff didn't run."

**Fix**: Print a status message when no changes are found for any page.
