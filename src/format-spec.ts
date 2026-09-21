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
      { name: 'css', required: false, content: 'CSS; selectors are prefixed with .<name> automatically' },
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
    { type: 'image', syntax: '{{image:name}}', dataShape: '{ src, alt, width?, height?, loading?, class? }', notes: 'src required; alt required when validation.requireAltText is true.' },
    { type: 'link', syntax: '{{link:name}}', dataShape: '{ href, label, class? }', notes: 'href and label required.' },
    { type: 'list', syntax: '{{#list:name}}...{{/list:name}}', dataShape: 'array of objects, or array of scalars', notes: 'Object items use {{text:field}}; scalar items use {{text:this}}.' },
    { type: 'bool', syntax: '{{#bool:name}}...{{/bool:name}}', dataShape: 'boolean', notes: 'Renders the block only when true.' },
    { type: 'slot', syntax: '{{slot:name}}', dataShape: '{ component, data? }', notes: 'Embeds another component. Max depth 3; cycles rejected.' },
  ],
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
      head: '{ meta?: [{name, content}], link?: [{rel, href}] }',
      scripts: '[{ src, defer?, async?, type?, head? }]',
    },
    assembly: {
      firstComponent: 'header',
      lastComponentIfNamedFooter: 'footer',
      others: 'section',
      defaultFooter: 'appended only when no component named "footer" is present',
    },
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
      'paths.build': 'directory name',
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
