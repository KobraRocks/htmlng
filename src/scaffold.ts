import { writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './config.js';
import { parseComponent } from './component.js';
import { EngineError } from './types.js';

const COMPONENT_TEMPLATE = `<h2>{{text:heading}}</h2>
<p>{{text:body}}</p>
---
/*
 * CSS — styles scoped to .{{name}}
 * Write selectors naturally; the engine prefixes them with .{{name}}
 *
 * Placeholder types:
 *   {{text:name}}          Text with inline formatting (<strong>, <em>, <a href>, <code>, <br>)
 *   {{html:name}}          Raw HTML (unsanitized)
 *   {{image:name}}         <img> element  → data: { src, alt, width?, height?, loading? }
 *   {{link:name}}          <a> element    → data: { href, label, class? }
 *   {{#list:name}}...{{/list:name}}  Repeated block  → data: array
 *     For object items: {{text:field}}    For scalar items: {{text:this}}
 *   {{#bool:name}}...{{/bool:name}}  Conditional block → data: true/false
 *   {{slot:name}}          Nested component → data: { component, data? }
 */
---
{
  "heading": { "type": "text", "required": true, "maxLength": 120 },
  "body":    { "type": "text", "required": false }
}
`;

const PAGE_TEMPLATE = `title: "{{name}}"
description: ""
components: []
`;

const GLOBAL_CSS = `:root {
  --color-primary: {{primary}};
  --color-primary-hover: {{primary-hover}};
  --color-text: {{text}};
  --color-text-muted: {{text-muted}};
  --color-bg: {{bg}};
  --color-bg-alt: {{bg-alt}};
  --color-border: {{border}};
  --font-family: {{font-family}};
  --font-size-base: {{font-size-base}};
  --font-size-h1: {{font-size-h1}};
  --font-size-h2: {{font-size-h2}};
  --font-size-h3: {{font-size-h3}};
  --font-size-h4: {{font-size-h4}};
  --line-height: {{line-height}};
  --line-height-heading: {{line-height-heading}};
  --space-xs: {{space-xs}};
  --space-sm: {{space-sm}};
  --space-md: {{space-md}};
  --space-lg: {{space-lg}};
  --space-xl: {{space-xl}};
  --radius-sm: {{radius-sm}};
  --radius-md: {{radius-md}};
}

*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; font-family: var(--font-family); font-size: var(--font-size-base); color: var(--color-text); background: var(--color-bg); }

h1 { font-size: var(--font-size-h1); font-weight: 700; line-height: var(--line-height-heading); margin-bottom: var(--space-md); }
h2 { font-size: var(--font-size-h2); font-weight: 600; line-height: var(--line-height-heading); margin-bottom: var(--space-md); }
h3 { font-size: var(--font-size-h3); font-weight: 600; line-height: var(--line-height-heading); margin-bottom: var(--space-sm); }
h4 { font-size: var(--font-size-h4); font-weight: 500; line-height: var(--line-height-heading); }
p  { line-height: var(--line-height); margin-bottom: var(--space-md); color: var(--color-text); }
a  { color: var(--color-primary); text-decoration: none; }
a:hover { color: var(--color-primary-hover); text-decoration: underline; }
ul, ol { padding-left: 1.5rem; margin-bottom: var(--space-md); }
li { margin-bottom: var(--space-sm); }
blockquote { border-left: 3px solid var(--color-border); padding-left: var(--space-md); color: var(--color-text-muted); }
`;

const DESIGN_TOKENS = `# Design tokens — edit values to customize global styles
# global.css uses {{name}} placeholders resolved against this file

primary: "#0066cc"
primary-hover: "#0052a3"
text: "#1a1a1a"
text-muted: "#555"
bg: "#ffffff"
bg-alt: "#f5f5f5"
border: "#e0e0e0"

font-family: "system-ui, -apple-system, sans-serif"
font-size-base: "1rem"
font-size-h1: "2.5rem"
font-size-h2: "2rem"
font-size-h3: "1.5rem"
font-size-h4: "1.25rem"
line-height: "1.6"
line-height-heading: "1.2"

space-xs: "0.25rem"
space-sm: "0.5rem"
space-md: "1rem"
space-lg: "2rem"
space-xl: "4rem"

radius-sm: "4px"
radius-md: "8px"
`;

const CONFIG_TEMPLATE = `project:
  name: "{{name}}"
  lang: "en"

paths:
  components: "components"
  pages: "pages"
  data: "data"
  assets: "assets"
  build: "build"

build:
  inlineCSS: false

validation:
  strict: false
  requireAltText: true
`;

export function initProject(rootDir: string, name?: string): void {
  const projectName = name ?? 'my-project';

  mkdirSync(join(rootDir, 'components'), { recursive: true });
  mkdirSync(join(rootDir, 'pages'), { recursive: true });
  mkdirSync(join(rootDir, 'data'), { recursive: true });
  mkdirSync(join(rootDir, 'presets'), { recursive: true });

  writeFileSync(
    join(rootDir, 'engine.config.yaml'),
    CONFIG_TEMPLATE.replace('{{name}}', projectName),
  );
  writeFileSync(join(rootDir, 'global.css'), GLOBAL_CSS);
  writeFileSync(join(rootDir, 'design-tokens.yaml'), DESIGN_TOKENS);
}

export function scaffoldComponent(rootDir: string, name: string): void {
  const config = loadConfig(rootDir);
  mkdirSync(join(rootDir, config.paths.components), { recursive: true });

  const content = COMPONENT_TEMPLATE.replace(/\{\{name\}\}/g, name);
  writeFileSync(
    join(rootDir, config.paths.components, `${name}.component.html`),
    content,
  );
}

export function scaffoldPage(rootDir: string, name: string): void {
  const config = loadConfig(rootDir);
  mkdirSync(join(rootDir, config.paths.pages), { recursive: true });

  const content = PAGE_TEMPLATE.replace('{{name}}', name);
  writeFileSync(
    join(rootDir, config.paths.pages, `${name}.page.yaml`),
    content,
  );
}

export function scaffoldData(
  rootDir: string,
  pageName: string,
  componentName: string,
): void {
  const config = loadConfig(rootDir);
  const compPath = join(rootDir, config.paths.components, `${componentName}.component.html`);
  const comp = parseComponent(compPath);

  const dir = join(rootDir, config.paths.data, pageName);
  mkdirSync(dir, { recursive: true });

  // Generate YAML with every schema key represented by a valid empty value
  const lines: string[] = [];
  for (const [key, def] of Object.entries(comp.schema)) {
    switch (def.type) {
      case 'image':
        lines.push(`${key}:`);
        lines.push(`  src: ""`);
        lines.push(`  alt: ""`);
        lines.push(`  # width: 0`);
        lines.push(`  # height: 0`);
        lines.push(`  # loading: lazy`);
        break;
      case 'link':
        lines.push(`${key}:`);
        lines.push(`  href: ""`);
        lines.push(`  label: ""`);
        lines.push(`  # class: ""`);
        break;
      case 'slot':
        lines.push(`${key}:`);
        lines.push(`  component: ""   # name of another component to embed`);
        lines.push(`  # data: {}`);
        break;
      case 'list': {
        const item = extractListItemFields(comp.template, key);
        if (item.scalar) {
          lines.push(`${key}:`);
          lines.push(`  - ""`);
        } else if (item.fields.length > 0) {
          lines.push(`# Expected fields per item: ${item.fields.join(', ')}`);
          lines.push(`${key}:`);
          lines.push(`  - ${item.fields[0]}: ""`);
          for (const f of item.fields.slice(1)) lines.push(`    ${f}: ""`);
        } else {
          lines.push(`${key}: []`);
        }
        break;
      }
      case 'bool':
        lines.push(`${key}: false`);
        break;
      default:
        lines.push(`${key}: ""`);
    }
  }

  writeFileSync(
    join(dir, `${componentName}.yaml`),
    lines.join('\n') + '\n',
  );
}

/** Derive the placeholder fields a `{{#list:name}}` block expects from the template. */
function extractListItemFields(template: string, listName: string): { fields: string[]; scalar: boolean } {
  const blockRe = new RegExp(
    `\\{\\{\\s*#list:${listName}\\s*\\}\\}([\\s\\S]*?)\\{\\{\\s*/list:${listName}\\s*\\}\\}`,
  );
  const match = blockRe.exec(template);
  if (!match) return { fields: [], scalar: false };

  const inner = match[1];
  const fields = [...new Set(
    [...inner.matchAll(/\{\{\s*text:(\w+)\s*\}\}/g)].map((m) => m[1]).filter((n) => n !== 'this'),
  )];
  return { fields, scalar: /\{\{\s*text:this\s*\}\}/.test(inner) };
}

export function scaffoldPresetComponent(rootDir: string, name: string, presetName: string): void {
  const config = loadConfig(rootDir);
  const presetPath = join(rootDir, 'presets', `${presetName}.component.html`);

  let content: string;
  try {
    content = readFileSync(presetPath, 'utf-8');
  } catch {
    throw new EngineError(`Preset not found: ${presetName}`, presetPath, undefined, 'ERROR', undefined, 'PRESET_NOT_FOUND');
  }

  const destPath = join(rootDir, config.paths.components, `${name}.component.html`);
  writeFileSync(destPath, content);
}

export function savePreset(rootDir: string, componentName: string, presetName: string): void {
  const config = loadConfig(rootDir);
  const srcPath = join(rootDir, config.paths.components, `${componentName}.component.html`);
  const destDir = join(rootDir, 'presets');

  mkdirSync(destDir, { recursive: true });

  const content = readFileSync(srcPath, 'utf-8');
  const destPath = join(destDir, `${presetName}.component.html`);
  writeFileSync(destPath, content);
}

export function listPresets(rootDir: string): string[] {
  try {
    const files = readdirSync(join(rootDir, 'presets'));
    return files.filter(f => f.endsWith('.component.html')).map(f => f.replace('.component.html', ''));
  } catch {
    return [];
  }
}
