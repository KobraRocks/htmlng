import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './config.js';
import { parseComponent } from './component.js';

const COMPONENT_TEMPLATE = `<h2>{{text:heading}}</h2>
<p>{{text:body}}</p>
---
/*
  Placeholder types:
  {{text:name}}          Text with inline formatting (<strong>, <em>, <a href>, <code>, <br>)
  {{html:name}}          Raw HTML (unsanitized)
  {{image:name}}         <img> element  → data: { src, alt, width?, height?, loading? }
  {{link:name}}          <a> element    → data: { href, label, class? }
  {{#list:name}}...{{/list:name}}  Repeated block  → data: array
    For object items: {{text:field}}    For scalar items: {{text:this}}
  {{#bool:name}}...{{/bool:name}}  Conditional block → data: true/false
  {{slot:name}}          Nested component → data: { component, data? }
*/
---
/*
 * CSS — styles scoped to .{{name}}
 * Write selectors naturally; the engine prefixes them with .{{name}}
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
  --color-primary: #0066cc;
  --color-primary-hover: #0052a3;
  --color-text: #1a1a1a;
  --color-text-muted: #555;
  --color-bg: #ffffff;
  --color-bg-alt: #f5f5f5;
  --color-border: #e0e0e0;
  --font-family: system-ui, -apple-system, sans-serif;
  --font-size-base: 1rem;
  --font-size-h1: 2.5rem;
  --font-size-h2: 2rem;
  --font-size-h3: 1.5rem;
  --font-size-h4: 1.25rem;
  --line-height: 1.6;
  --line-height-heading: 1.2;
  --space-xs: 0.25rem;
  --space-sm: 0.5rem;
  --space-md: 1rem;
  --space-lg: 2rem;
  --space-xl: 4rem;
  --radius-sm: 4px;
  --radius-md: 8px;
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
  minify: false
  pretty: true
  assetFingerprinting: false

validation:
  strict: false
  requireAltText: true
  maxHeadingLength: 120
`;

export function initProject(rootDir: string, name?: string): void {
  const projectName = name ?? 'my-project';

  mkdirSync(join(rootDir, 'components'), { recursive: true });
  mkdirSync(join(rootDir, 'pages'), { recursive: true });
  mkdirSync(join(rootDir, 'data'), { recursive: true });
  mkdirSync(join(rootDir, 'assets'), { recursive: true });

  writeFileSync(
    join(rootDir, 'engine.config.yaml'),
    CONFIG_TEMPLATE.replace('{{name}}', projectName),
  );
  writeFileSync(join(rootDir, 'global.css'), GLOBAL_CSS);
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

  // Generate YAML with all schema keys set to null
  const lines: string[] = [];
  for (const [key, def] of Object.entries(comp.schema)) {
    if (def.type === 'image' || def.type === 'link' || def.type === 'slot') {
      lines.push(`${key}:`);
      lines.push(`  src: null`);
      if (def.type === 'image') lines.push(`  alt: null`);
      if (def.type === 'link') { lines.push(`  label: ""`); lines.push(`  # class: ""`); }
    } else if (def.type === 'list') {
      // Extract sub-fields used in the list block for hints
      const blockRe = new RegExp(`\\{\\{\\s*#list:${key}\\s*\\}\\}([\\s\\S]*?)\\{\\{\\s*/list:${key}\\s*\\}\\}`, 'g');
      const blockMatch = blockRe.exec(comp.template);
      if (blockMatch) {
        const innerFields = [...blockMatch[1].matchAll(/\{\{text:(\w+)\}\}/g)].map(m => m[1]);
        if (innerFields.length > 0) {
          lines.push(`# Expected fields per item: ${innerFields.join(', ')}`);
        }
      }
      lines.push(`${key}:`);
      lines.push(`  - title: ""`);
      lines.push(`    description: ""`);
    } else if (def.type === 'bool') {
      lines.push(`${key}: false`);
    } else {
      lines.push(`${key}: ""`);
    }
  }

  writeFileSync(
    join(dir, `${componentName}.yaml`),
    lines.join('\n') + '\n',
  );
}
