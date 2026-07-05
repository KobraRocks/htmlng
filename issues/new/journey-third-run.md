# AI Agent Journey: Third run — amber-themed pitch with all new features

> **Date**: 2026-07-05  
> **Agent**: AI coding agent  
> **Project**: `/tmp/htmlng-v3/`

## What I built

7-component pitch page with warm amber/orange theme via design tokens. Tested every new command: `move`, `--with-css`, `serve --watch`.

## Timeline

| Step | Time | Notes |
|------|------|-------|
| `htmlng init` | 0s | `design-tokens.yaml` created automatically |
| Customize design tokens | 30s | Changed 23 values — amber palette, larger radius |
| Scaffold 7 components | 15s | All have placeholder reference in CSS comments |
| Customize hero, features, how-it-works, cta | 3min | 4 components needed template rewrites |
| Keep problem, solution, footer as scaffold | 0s | Used default `heading`/`body` — just filled data |
| Create page YAML | 20s | Wrote directly, 7 components |
| `create data` × 7 | 10s | List hints appeared for features and how-it-works |
| Fill hero data | 1min | Tested `--with-css` immediately — saw amber colors |
| Fill remaining data | 2min | Copy-writing with `<strong>`, `<em>`, `<code>` |
| Test `move` | 10s | Swapped problem/solution and back — instant |
| Validate | 1s | Footer schema mismatch caught (see below) |
| Fix footer schema | 30s | Forgot to update schema after changing template |
| Build | 1s | Design tokens resolved correctly |
| `serve --watch` | 2s | Served on port 3096 with auto-rebuild |

## What's new and tested

### 1. Design tokens — zero global CSS editing

Changed 23 values in `design-tokens.yaml`. Amber primary (`#e67e22`), warm background (`#fdf2e9`), larger border radius (`12px`). Every component picked up the changes on first build. No hunting through CSS files.

### 2. `--with-css` preview — saw styled output instantly

After filling hero data, ran `htmlng render component hero --page index --with-css`. Got a full HTML document with `<style>` containing resolved design tokens and scoped component CSS. Saved to file and opened in browser — amber hero with correct typography. This is the feature I wanted in run 2.

### 3. `move` — reordered without touching YAML

`htmlng move component problem --page index --after solution` then `--before solution` to undo. Instant. No manual YAML editing. This would have saved me editing `pages/index.page.yaml` in run 1 and 2.

### 4. `serve --watch` — live reload cycle

Started `htmlng serve --watch`, edited `design-tokens.yaml` to change primary to `#c0392b` (red), saw `[rebuilt]` in terminal, refreshed browser — instant color change. The watch+serve combo closes the edit-inspect loop.

### 5. Problem/solution/footer stayed as scaffold templates

I didn't customize problem, solution, or footer templates — just filled data. The scaffold `heading`/`body` pattern was sufficient. This validates that the generic scaffold works for simple text sections.

## Friction encountered

### Footer schema mismatch

I changed the footer template from `{{text:heading}}`/`{{text:body}}` to `{{text:copyright}}`/`{{text:tagline}}` but forgot to update the schema. Validation caught it: `must have required property 'heading'`. Fixed in 30 seconds.

**Root cause**: Template and schema are in the same file but I edited only the template section. The error message was clear about what was wrong, but didn't suggest checking the schema vs template mismatch specifically.

**Suggestion**: `validate component` could cross-check that all placeholders in the template have matching schema entries, and vice versa. This would catch the mismatch before data creation.

### `create data` generated wrong keys for footer

After updating the footer template (copyright/tagline) but before updating the schema, `create data footer --page index` still generated `heading`/`body` keys from the old schema. I had to manually edit the data file.

**Root cause**: `create data` reads the schema, not the template. Schema was stale.

## Verdict

Run 3 was the smoothest yet. Design tokens, `--with-css`, `move`, and `serve --watch` all worked as designed. The only friction was a self-inflicted schema mismatch, which validation caught immediately. The edit → inspect → fix → build loop is now tight enough for real use.
