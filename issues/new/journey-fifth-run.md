# AI Agent Journey: Fifth run — presets cut ~40% of build time

> **Date**: 2026-07-05  
> **Agent**: AI coding agent  
> **Project**: `/tmp/htmlng-v5/`

## What I built

7-component pitch page in ~2 minutes — **zero template customization**. Blue theme (`#2563eb`), component presets reused from run 4.

## Timeline

| Step | Time | Notes |
|------|------|-------|
| `htmlng init` | 0s | design-tokens.yaml created |
| Customize design tokens | 30s | Blue theme |
| Copy presets from run 4 | 5s | `cp ../htmlng-v4/presets/* presets/` |
| Create 7 components from presets | 10s | `--preset hero`, `--preset features`, etc. |
| **No template customization** | **0s** | Presets had all CSS, templates, schemas |
| Create page YAML | 15s | Wrote directly |
| `create data` × 7 | 8s | List hints from preset schemas |
| Fill all 7 data files | 1min | Copy-writing only — no CSS/HTML editing |
| Validate | 1s | Clean |
| Build | 1s | Blue tokens resolved |
| Hot reload test | 5s | Design token change → CSS rebuilt → browser reload |

## What presets changed

**Before** (run 4): 4min customizing 5 component templates.  
**After** (run 5): 0s customizing. 7 components scaffolded from presets in 10s.

The AI's work shifted from "write HTML + CSS + schema" to "fill YAML data." This is the engine's core promise — AI edits content, engine provides structure — fully realized.

## Bug found and fixed: hot reload didn't rebuild CSS

When I changed `design-tokens.yaml` during hot reload, the browser refreshed but colors didn't change. The watch handler rebuilt `index.html` but not `css/index.css`. Fixed by adding CSS regeneration to the watch rebuild path. Now both HTML and CSS rebuild on file change.

## Verdict

Presets are the missing piece. Combined with design tokens and hot reload, the AI's entire workflow is now data-editing. The engine provides structure, the agent provides content. This is what the spec intended from day one.
