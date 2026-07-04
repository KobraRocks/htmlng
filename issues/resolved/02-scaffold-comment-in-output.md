# Issue: Scaffold component template includes HTML comment that leaks into rendered output

**Severity**: Low (cosmetic)  
**Found during**: QA — `render component hero --page index`

**Steps to reproduce**:
1. `engine create component hero`
2. `engine render component hero --page index`

**Expected**: Rendered output contains only the resolved template content.

**Actual**: Rendered output includes `<!-- hero.component.html -->` at the top. This is the scaffold template's file-name comment, which appears above the `---` delimiter and is treated as part of the template.

**Root cause**: `scaffold.ts` COMPONENT_TEMPLATE constant has `<!-- {{name}}.component.html -->` before the `---` section delimiter. Since the `---` splits the file into template/CSS/schema sections, the comment lands in the template section and gets rendered.

**Fix**: Remove the comment from the scaffold template, or place it after the first `---` (in the CSS section as a CSS comment).
