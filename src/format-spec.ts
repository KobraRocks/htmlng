/**
 * Machine-readable description of every file format the engine consumes.
 * Emitted by `htmlng schema` so an agent can self-check before invoking the
 * engine, without reverse-engineering the parser.
 */
export const FORMAT_SPEC = {
  version: 1,
  componentFile: {
    extension: '.component.html',
    location: 'components/<name>.component.html',
    separator: 'a line containing only --- (surrounding whitespace ignored)',
    sections: [
      { name: 'template', required: true, content: 'HTML containing {{type:name}} placeholders' },
      { name: 'css', required: false, content: 'CSS; selectors are prefixed with .<name> automatically. Root selectors (html, body, :root, :host) and any selector containing :global(...) are emitted unscoped.' },
      { name: 'schema', required: true, content: 'JSON object mapping placeholder name -> definition' },
    ],
    sectionOrder: ['template', 'css?', 'schema'],
    schemaEntry: {
      type: 'text | html | image | link | list | bool | slot',
      required: 'boolean, optional (default false)',
      maxLength: 'number, optional (text/html only)',
    },
    example:
      '<h2>{{text:heading}}</h2>\n' +
      '<p>{{text:body}}</p>\n' +
      '---\n' +
      'h2 { font-size: 2rem; }\n' +
      '---\n' +
      '{ "heading": { "type": "text", "required": true, "maxLength": 120 }, "body": { "type": "text" } }',
  },
  placeholderTypes: [
    { type: 'text', syntax: '{{text:name}}', dataShape: 'string', notes: 'Inline tags only (see textFieldWhitelist).' },
    { type: 'html', syntax: '{{html:name}}', dataShape: 'string', notes: 'Raw, unsanitized block HTML.' },
    { type: 'image', syntax: '{{image:name}}', dataShape: '{ src, alt, width?, height?, loading?, class? }', notes: 'src required; alt required when validation.requireAltText is true. Emits a complete <img> element — never use it as an attribute value.' },
    { type: 'link', syntax: '{{link:name}}', dataShape: '{ href, label, class? }', notes: 'href and label required. Emits a complete <a> element — never use it as an attribute value.' },
    { type: 'list', syntax: '{{#list:name}}...{{/list:name}}', dataShape: 'array of objects, or array of scalars', notes: 'Iterates an array INSIDE one component instance. Object items use {{text:field}}; scalar items use {{text:this}}. Item fields are not component schema fields. To repeat the whole component, use an array data file instead (see dataShapes).' },
    { type: 'bool', syntax: '{{#bool:name}}...{{/bool:name}}', dataShape: 'boolean', notes: 'Renders the block only when the value is exactly true.' },
    { type: 'if', syntax: '{{#if:name}}...{{/if:name}}', dataShape: 'any', guardOnly: true, notes: 'Block guard: renders the block when the value is truthy (true, non-blank string, non-empty array/object, non-zero number). Same data scope as the component. NOT a schema type.' },
    { type: 'unless', syntax: '{{#unless:name}}...{{/unless:name}}', dataShape: 'any', guardOnly: true, notes: 'Inverse of {{#if:name}}. NOT a schema type.' },
    { type: 'slot', syntax: '{{slot:name}}', dataShape: '{ component, data? }', notes: 'Embeds another component inline. Max depth 3; cycles rejected. Emits an element — never use it as an attribute value.' },
  ],
  /** The only valid values for a schema entry's `type` (guards like if/unless are not listed). */
  schemaTypes: ['text', 'html', 'image', 'link', 'list', 'bool', 'slot'],
  textFieldWhitelist: {
    tags: ['strong', 'b', 'em', 'i', 'a', 'code', 'br', 'mark', 'del', 'ins', 'sub', 'sup', 'small'],
    attributes: { a: ['href'] },
    note: 'Any other tag or attribute is rejected. Block-level tags must use {{html:field}}.',
  },
  urlSafety: {
    blockedSchemes: ['javascript:', 'vbscript:', 'file:', 'blob:'],
    dataUrls: 'rejected, except raster data:image/<type> for image src (SVG is excluded)',
    allowed: 'http(s), mailto, tel, fragment (#...), and relative paths',
    appliesTo: 'link.href, image.src, and <a href> inside text fields',
  },
  pageFile: {
    extension: '.page.yaml',
    location: 'pages/<name>.page.yaml',
    required: { title: 'string', description: 'string', components: 'array of component names (order defines layout)' },
    optional: {
      lang: 'string',
      favicon: 'string',
      viewport: 'string',
      layout: '{ wrapper?: boolean, bodyClass?: string }',
      head: '{ meta?: [{name, content}], link?: [{rel, href}] }',
      scripts: '[{ src, defer?, async?, type?, head? }]',
    },
    assembly: {
      roleRule: 'the wrapper tag is derived from the component NAME, never its position: "header" -> <header>, "footer" -> <footer>, everything else -> <section id class>',
      ids: 'id and class are the component name; array data elements get id="<name>-<index>"',
      body: 'the engine always emits <body class="<page>" data-page="<page>">; layout.bodyClass appends extra classes',
      wrapper: 'layout.wrapper: true wraps all components in <div id="page" class="page">',
      scripts: 'page scripts are emitted at the end of <body> by default; head: true moves them to <head> and adds defer unless defer/async is set',
      defaultFooter: 'appended only when no component named "footer" is present',
    },
    ordering: 'page names are naturally sorted (slide-1, slide-2, slide-10); list pages, context, and build-all all use this order',
  },
  dataShapes: {
    singleInstance: 'a YAML map — one component instance; its keys are the schema fields',
    componentRepetition: 'a YAML sequence — the component renders once per element with ids <name>-0, <name>-1, …; the schema stays flat (fields at the top level) and the page lists the component once',
    nestedList: 'a `list` field inside one instance — {{#list:name}} iterates the array; item fields are read with {{text:field}} and are NOT component schema fields',
  },
  dataFile: {
    location: 'data/<page>/<component>.yaml',
    shape: 'a YAML map (one instance) or a YAML sequence (repeat the component once per element)',
    arrayIds: 'array elements always get indexed ids: <component>-0, <component>-1, ... (including a single-element array)',
  },
  configFile: {
    location: 'engine.config.yaml',
    fields: {
      'project.name': 'string',
      'project.lang': 'string',
      'paths.components': 'directory name',
      'paths.pages': 'directory name',
      'paths.data': 'directory name',
      'paths.assets': 'directory name',
      'paths.build': 'directory name (single path segment — no "/" or ".."); wiped when building all pages',
      'build.inlineCSS': 'boolean — emit CSS in a <style> tag instead of build/css/<page>.css',
      'validation.strict': 'boolean — treat warnings as errors',
      'validation.requireAltText': 'boolean — require alt text on image placeholders',
    },
  },
  projectStructure: [
    'engine.config.yaml',
    'global.css',
    'design-tokens.yaml',
    'components/<name>.component.html',
    'pages/<name>.page.yaml',
    'data/<page>/<component>.yaml',
    'assets/',
    'presets/<name>.component.html',
    'build/ (generated; do not edit)',
  ],
} as const;
