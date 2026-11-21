/**
 * Project-authoring commands that scaffold or edit source files: `init`,
 * `create`, `add`, `move`, and `save`.
 *
 * Wired into the `handlers` map in `cli.ts`; all project state arrives through
 * the injected `CliContext`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { load, dump } from 'js-yaml';
import type { CliContext } from './cli-context.js';
import { componentTarget, requireName } from './cli-args.js';
import { loadConfig } from './config.js';
import { parsePage } from './page.js';
import {
  initProject,
  scaffoldComponent,
  scaffoldPage,
  scaffoldData,
  scaffoldPresetComponent,
  savePreset,
} from './scaffold.js';

export async function cmdInit(ctx: CliContext, _args: string[]): Promise<number> {
  const name = ctx.flag('--name');
  initProject(ctx.root, name ?? undefined);
  if (ctx.jsonMode) ctx.emit({ ok: true, project: { name: name ?? 'my-project' } });
  else ctx.io.out(`Initialized project${name ? ` "${name}"` : ''}.\n`);
  return 0;
}

export async function cmdCreate(ctx: CliContext, args: string[]): Promise<number> {
  const what = args[0];
  if (what === 'component') {
    const name = requireName(args[1], 'component', 'htmlng create component <name> [--preset <p>]');
    const preset = ctx.flag('--preset');
    if (preset) {
      scaffoldPresetComponent(ctx.root, name, preset);
      if (ctx.jsonMode) ctx.emit({ ok: true, kind: 'component', name, preset });
      else ctx.io.out(`Created components/${name}.component.html from preset "${preset}"\n`);
    } else {
      scaffoldComponent(ctx.root, name);
      if (ctx.jsonMode) ctx.emit({ ok: true, kind: 'component', name });
      else ctx.io.out(`Created components/${name}.component.html\n`);
    }
    return 0;
  }
  if (what === 'page') {
    const name = requireName(args[1], 'page', 'htmlng create page <name>');
    scaffoldPage(ctx.root, name);
    if (ctx.jsonMode) ctx.emit({ ok: true, kind: 'page', name });
    else ctx.io.out(`Created pages/${name}.page.yaml\n`);
    return 0;
  }
  if (what === 'data') {
    const comp = requireName(args[1], 'component', 'htmlng create data <component> --page <page>');
    const page = ctx.flag('--page');
    if (!page) {
      ctx.emitJsonError('CLI_FLAG_MISSING', 'Error: --page <page> is required');
      return 1;
    }
    scaffoldData(ctx.root, page, comp);
    if (ctx.jsonMode) ctx.emit({ ok: true, kind: 'data', name: comp, page });
    else ctx.io.out(`Created data/${page}/${comp}.yaml\n`);
    return 0;
  }
  ctx.emitJsonError('CLI_UNKNOWN_COMMAND', 'Usage: htmlng create component|page|data ...', 'Run: htmlng --help');
  return 1;
}

export async function cmdAdd(ctx: CliContext, args: string[]): Promise<number> {
  const name = componentTarget(args);
  const page = ctx.flag('--page');
  if (!name || !page) {
    ctx.emitJsonError('CLI_MISSING_NAME', 'Usage: htmlng add component <name> --page <page>', 'Run: htmlng --help');
    return 1;
  }

  const config = loadConfig(ctx.root);
  const pagePath = join(ctx.root, config.paths.pages, `${page}.page.yaml`);
  const p = parsePage(pagePath);

  if (p.components.includes(name)) {
    if (ctx.jsonMode) ctx.emit({ ok: true, page, component: name, alreadyPresent: true });
    else ctx.io.out(`Component "${name}" is already in page "${page}".\n`);
    return 0;
  }

  p.components.push(name);
  saveComponents(pagePath, p.components);

  if (ctx.jsonMode) ctx.emit({ ok: true, page, component: name, alreadyPresent: false });
  else ctx.io.out(`Added "${name}" to page "${page}".\n`);
  return 0;
}

export async function cmdMove(ctx: CliContext, args: string[]): Promise<number> {
  const name = componentTarget(args);
  const page = ctx.flag('--page');
  const before = ctx.flag('--before');
  const after = ctx.flag('--after');
  if (!name || !page || (!before && !after)) {
    ctx.emitJsonError('CLI_MISSING_NAME', 'Usage: htmlng move component <name> --page <page> --before|--after <other>');
    return 1;
  }

  const config = loadConfig(ctx.root);
  const pagePath = join(ctx.root, config.paths.pages, `${page}.page.yaml`);
  const p = parsePage(pagePath);

  const current = p.components.indexOf(name);
  if (current === -1) {
    ctx.emitJsonError('COMPONENT_NOT_FOUND', `Component "${name}" not in page "${page}".`);
    return 1;
  }

  const target = before ?? after!;
  const targetIdx = p.components.indexOf(target);
  if (targetIdx === -1) {
    ctx.emitJsonError('COMPONENT_NOT_FOUND', `Component "${target}" not in page "${page}".`);
    return 1;
  }

  p.components.splice(current, 1);
  const insertAt = before ? p.components.indexOf(target) : p.components.indexOf(target) + 1;
  p.components.splice(insertAt, 0, name);
  saveComponents(pagePath, p.components);

  if (ctx.jsonMode) ctx.emit({ ok: true, page, component: name, [before ? 'before' : 'after']: target });
  else ctx.io.out(`Moved "${name}" ${before ? 'before' : 'after'} "${target}" in page "${page}".\n`);
  return 0;
}

export async function cmdSave(ctx: CliContext, args: string[]): Promise<number> {
  const presetName = ctx.flag('--as-preset');
  const compName = componentTarget(args);
  if (!compName || !presetName) {
    ctx.emitJsonError('CLI_MISSING_NAME', 'Usage: htmlng save component <name> --as-preset <preset-name>');
    return 1;
  }
  savePreset(ctx.root, compName, presetName);
  if (ctx.jsonMode) ctx.emit({ ok: true, component: compName, preset: presetName });
  else ctx.io.out(`Saved "${compName}" as preset "${presetName}".\n`);
  return 0;
}

/** Rewrite only the component list, so comments and formatting elsewhere survive. */
function saveComponents(pagePath: string, components: string[]): void {
  const raw = load(readFileSync(pagePath, 'utf-8')) as Record<string, unknown>;
  raw.components = components;
  writeFileSync(pagePath, dump(raw, { lineWidth: -1 }));
}
