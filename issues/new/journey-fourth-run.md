# AI Agent Journey: Fourth run — terminal-themed pitch, zero friction

> **Date**: 2026-07-05  
> **Agent**: AI coding agent  
> **Project**: `/tmp/htmlng-v4/`

## What I built

7-component pitch page with a terminal/monospace theme — green-on-dark (`#00ff88` on `#0d1117`), monospace fonts, blinking cursor animation in the hero, `$` prompt in subtext. 6 feature cards with emoji icons, 4 how-it-works steps with command examples.

## Timeline

| Step | Time | Notes |
|------|------|-------|
| `htmlng init` | 0s | design-tokens.yaml created |
| Customize design tokens | 30s | Green terminal theme, monospace fonts, zero border radius |
| Scaffold 7 components | 10s | All have placeholder reference in CSS |
| Customize 5 templates | 4min | Hero (blinking cursor CSS), features (icon+grid), how-it-works (command+desc), cta, footer |
| Problem/solution kept as scaffold | 0s | Just `heading`/`body` with `> ` prefix in content |
| Create page YAML | 15s | Wrote directly |
| `create data` × 7 | 8s | List hints for features (icon, title, description) and how-it-works (command, description) |
| Fill hero data | 1min | Tested `--with-css` immediately — saw green terminal theme |
| Fill remaining data | 3min | Copy-writing with emoji icons, `<strong>`, `<code>` tags |
| `move` swap + restore | 5s | Swapped problem/solution, verified order, swapped back |
| Validate | 1s | Clean pass, no errors |
| Build | 1s | Green tokens resolved correctly |
| `serve` | 2s | Served on port 3095 |

## What worked perfectly

### Design tokens: instant theme switch
23 values changed. Green primary, dark background, monospace fonts, sharp borders. Applied to every component on first build. If I wanted a blue theme instead, I'd change one line (`primary: "#0066cc"`) and rebuild.

### `--with-css` hero preview
After filling hero data, ran `htmlng render component hero --page index --with-css`. Got a full HTML document with resolved CSS. Green `#00ff88` on dark `#0d1117`. The `@keyframes blink` animation for the cursor rendered correctly in scoped CSS.

### `create data` list hints
For features: `# Expected fields per item: icon, title, description`  
For how-it-works: `# Expected fields per item: command, description`  
Both accurate. No schema lookups needed.

### Template-schema cross-validation silent
I didn't trigger it because I kept templates and schemas in sync. This is the ideal case — the validation stays out of the way when things are correct, and only surfaces when there's a mismatch.

### `move` instant reorder
Swapped problem/solution positions and back. Instant. No YAML editing.

### No friction with `<code>` in text fields
Used `<code>` extensively in how-it-works command descriptions. All passed text validation. The whitelist works transparently.

### `@keyframes` passes through CSS scoping
The blinking cursor animation in the hero (`@keyframes blink`) was preserved unchanged in the scoped CSS output.

## No new friction found

This was the first run with zero issues. No schema mismatches, no parser bugs, no missing features. The edit → render → build loop is smooth.

## Verdict

Run 4 was friction-free. The engine is production-ready for AI agent use. The remaining improvements are quality-of-life (hot reload injection in serve, component presets) rather than blockers.
