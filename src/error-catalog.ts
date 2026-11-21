/**
 * Catalog of stable error codes.
 *
 * Every `EngineError` carries a `code` that is safe to match on programmatically
 * (`--json` output) and stable across releases. `htmlng explain <code>` renders
 * the same entries for humans and agents.
 */

export interface CatalogEntry {
  summary: string;
  fix: string;
}

export const ERROR_CATALOG: Record<string, CatalogEntry> = {
  // ── Component files ───────────────────────────────────
  COMPONENT_NOT_FOUND: {
    summary: 'A page references a component whose file does not exist.',
    fix: 'Check the component name in the page YAML against components/<name>.component.html, or run "htmlng list components".',
  },
  COMPONENT_SECTIONS_MISSING: {
    summary: 'A component file has no "---" separator between template and schema.',
    fix: 'A component file is template, optional CSS, and JSON schema, separated by lines containing only "---".',
  },
  COMPONENT_SECTIONS_EXCESS: {
    summary: 'A component file has more than three sections.',
    fix: 'Remove extra "---" lines. Only three sections are allowed: template, CSS, schema.',
  },
  COMPONENT_SCHEMA_JSON: {
    summary: 'The schema section is not valid JSON.',
    fix: 'The last section after "---" must be a JSON object, e.g. {"heading":{"type":"text"}}.',
  },
  COMPONENT_PLACEHOLDER_TYPE: {
    summary: 'A schema entry uses a placeholder type the engine does not support.',
    fix: 'Use one of: text, html, image, link, list, bool, slot.',
  },
  COMPONENT_SCRIPT_FORBIDDEN: {
    summary: 'A component template contains a <script> tag.',
    fix: 'Declare scripts in the page YAML "scripts:" list instead — components may not contain <script>.',
  },
  COMPONENT_STYLE_FORBIDDEN: {
    summary: 'A component template contains a <style> tag.',
    fix: 'Put styles in the component CSS section (after the first "---"); it is scoped automatically.',
  },
  COMPONENT_INLINE_STYLE: {
    summary: 'A component template contains an inline style="..." attribute.',
    fix: 'Move the styling into the component CSS section.',
  },
  COMPONENT_REDUNDANT_WRAPPER: {
    summary: 'A template wraps its whole content in <div class="<component-name>">.',
    fix: 'Remove the outer div — the engine already emits the semantic wrapper with that class.',
  },
  COMPONENT_PLACEHOLDER_IN_ATTRIBUTE: {
    summary: 'An {{image:...}}, {{link:...}} or {{slot:...}} placeholder is used as an attribute value.',
    fix: 'Those placeholders emit a whole element. Use them as element content, e.g. <span class="logo">{{image:logo}}</span>, and style the box in the CSS section.',
  },

  // ── Template / placeholders ───────────────────────────
  TEMPLATE_PLACEHOLDER_UNKNOWN: {
    summary: 'The template uses a placeholder that the schema does not define.',
    fix: 'Add the field to the schema section, or fix the name in the template. Check for typos.',
  },
  TEMPLATE_UNCLOSED_BLOCK: {
    summary: 'A {{#list:...}}, {{#bool:...}}, {{#if:...}} or {{#unless:...}} block is missing its closing tag.',
    fix: 'Add the matching {{/list:name}}, {{/bool:name}}, {{/if:name}} or {{/unless:name}}.',
  },
  TEMPLATE_UNKNOWN_BLOCK: {
    summary: 'A block uses a type other than list, bool, if or unless.',
    fix: 'Blocks are {{#list:name}}, {{#bool:name}}, {{#if:name}} and {{#unless:name}}.',
  },
  TEMPLATE_UNKNOWN_PLACEHOLDER: {
    summary: 'A {{type:name}} placeholder uses an unknown type.',
    fix: 'Use one of: text, html, image, link, list, bool, slot.',
  },
  SLOT_UNKNOWN_COMPONENT: {
    summary: 'A {{slot:...}} references a component that does not exist.',
    fix: 'Check the "component:" value in the slot data against components/*.component.html.',
  },
  SLOT_CIRCULAR: {
    summary: 'A {{slot:...}} eventually embeds itself.',
    fix: 'Break the cycle in the slot data so no component embeds itself directly or indirectly.',
  },
  SLOT_DEPTH_EXCEEDED: {
    summary: 'Slots are nested more than three levels deep.',
    fix: 'Flatten the slot nesting, or inline the deeper content in the parent component.',
  },

  // ── Text fields ───────────────────────────────────────
  TEXT_BLOCK_TAG: {
    summary: 'A text field contains a block-level HTML tag.',
    fix: 'Use a {{html:field}} placeholder for block-level content, or remove the tag.',
  },
  TEXT_TAG_DISALLOWED: {
    summary: 'A text field contains a tag outside the inline whitelist.',
    fix: 'Use only strong, b, em, i, a, code, br, mark, del, ins, sub, sup, small.',
  },
  TEXT_ATTR_DISALLOWED: {
    summary: 'A text field uses an attribute that is not allowed on that tag.',
    fix: 'Only <a href="..."> accepts an attribute; every other allowed tag is attribute-free.',
  },
  UNSAFE_URL: {
    summary: 'A URL uses a dangerous scheme (javascript:, vbscript:, file:, blob:, or a disallowed data: URL).',
    fix: 'Use an http(s), mailto, tel, fragment (#...), or relative URL. Images may use raster data:image/<type> URLs (not SVG).',
  },

  // ── Data ──────────────────────────────────────────────
  SCHEMA_VALIDATION: {
    summary: 'A data file does not match the component schema.',
    fix: 'Fix the reported field/type. Use "htmlng create data <component> --page <page>" to regenerate a valid skeleton.',
  },
  DATA_ARRAY_ITEM_INVALID: {
    summary: 'An array data file has an element that is not an object.',
    fix: 'Each element of an array data file must be a map of placeholder values.',
  },
  DATA_ROOT_INVALID: {
    summary: 'A data file root is neither a map nor a sequence.',
    fix: 'A data file must contain a YAML object (one instance) or an array (repeated instances).',
  },
  DATA_PARSE: {
    summary: 'A data file could not be parsed as YAML.',
    fix: 'Check the YAML syntax and indentation.',
  },
  DATA_KEY_UNUSED: {
    summary: 'A data file sets a key the component schema does not use.',
    fix: 'Remove the key, or add it to the component schema if it is intended.',
  },
  DATA_FILE_ORPHAN: {
    summary: 'A data file exists for a component the page no longer lists.',
    fix: 'Delete data/<page>/<component>.yaml, or add the component back to the page. A stale file is silently picked up if the component returns.',
  },
  SCHEMA_FIELD_UNUSED: {
    summary: 'A component schema defines a field the template never uses.',
    fix: 'Remove the field from the schema, or reference it with {{...field}} in the template.',
  },
  ALT_TEXT_REQUIRED: {
    summary: 'An image is missing alt text and validation.requireAltText is true.',
    fix: 'Add "alt:" to the image data, or set validation.requireAltText: false.',
  },

  // ── Pages ─────────────────────────────────────────────
  PAGE_NOT_FOUND: {
    summary: 'The named page file does not exist.',
    fix: 'Check the name against pages/*.page.yaml, or run "htmlng list pages".',
  },
  PAGE_PARSE: {
    summary: 'A page YAML could not be parsed.',
    fix: 'Check the YAML syntax and indentation.',
  },
  PAGE_TITLE_INVALID: {
    summary: 'A page is missing its "title" string.',
    fix: 'Add a top-level "title: \\"...\\"" to the page YAML.',
  },
  PAGE_DESCRIPTION_INVALID: {
    summary: 'A page is missing its "description" string.',
    fix: 'Add a top-level "description: \\"...\\"" to the page YAML.',
  },
  PAGE_COMPONENTS_INVALID: {
    summary: 'A page is missing its "components" array.',
    fix: 'Add "components:" followed by an indented list of component names.',
  },
  PAGE_NO_COMPONENTS: {
    summary: 'A page lists no components.',
    fix: 'Add at least one component to the page YAML, e.g. "components:\n  - hero".',
  },
  PAGE_NO_BODY: {
    summary: 'The assembled HTML has no <body> element.',
    fix: 'This is an engine bug unless a component emitted a malformed tag; report it.',
  },
  PAGE_BODY_UNCLOSED: {
    summary: 'The assembled HTML has an unclosed <body> tag.',
    fix: 'Check component templates for an unbalanced </body> or stray tag.',
  },
  PAGE_BODY_CHILD: {
    summary: 'The body has a direct child other than header/section/footer, a page script, or the layout wrapper.',
    fix: 'The engine emits the wrappers, page scripts, and the optional <div id="page">. A raw top-level <div> usually means a component template added an extra wrapper — the engine already wraps each component.',
  },
  PAGE_LAYOUT_INVALID: {
    summary: 'A page "layout" field has the wrong type.',
    fix: 'layout.wrapper must be a boolean and layout.bodyClass a string.',
  },
  PAGE_DUPLICATE_ID: {
    summary: 'Two elements in the page share the same id.',
    fix: 'Ids come from component names; a component named "footer" or a raw id in a template can collide.',
  },

  // ── Config ────────────────────────────────────────────
  CONFIG_LOAD: {
    summary: 'engine.config.yaml is missing or could not be parsed.',
    fix: 'Run "htmlng init" in an empty directory, or fix the YAML.',
  },
  CONFIG_PATH_TRAVERSAL: {
    summary: 'A paths.* value contains "/" or "..".',
    fix: 'Paths point to a single directory name relative to the project root.',
  },

  // ── CLI usage ─────────────────────────────────────────
  CLI_UNKNOWN_COMMAND: {
    summary: 'The command name is not recognized.',
    fix: 'Run "htmlng --help" for the command list.',
  },
  CLI_UNKNOWN_ERROR_CODE: {
    summary: 'The requested error code is not in the catalog.',
    fix: 'Run "htmlng explain" to list every code.',
  },
  CLI_UNKNOWN_FLAG: {
    summary: 'An unknown flag was passed.',
    fix: 'Run "htmlng --help" for the supported flags. Unknown flags are rejected so typos cannot be ignored.',
  },
  CLI_FLAG_VALUE_MISSING: {
    summary: 'A flag that needs a value was given none.',
    fix: 'Pass the value, e.g. --page index.',
  },
  CLI_FLAG_MISSING: {
    summary: 'A flag required by the command was not provided.',
    fix: 'Check the command usage in "htmlng --help" and supply the missing flag, e.g. --page <page>.',
  },
  CLI_MISSING_NAME: {
    summary: 'A scaffolding command was run without a name.',
    fix: 'Provide a name, e.g. "htmlng create component hero".',
  },
  CLI_INVALID_NAME: {
    summary: 'A resource name contains disallowed characters.',
    fix: 'Names may contain letters, digits, "-" and "_", and may not contain path separators.',
  },
  PRESET_NOT_FOUND: {
    summary: 'The preset name does not exist.',
    fix: 'Run "htmlng list presets" to see available presets.',
  },

  E_UNKNOWN: {
    summary: 'An error without a specific code.',
    fix: 'Read the message and file reference; run "htmlng --help" for usage.',
  },
};

export function explainError(code: string): CatalogEntry | null {
  return ERROR_CATALOG[code] ?? null;
}

export function allErrorCodes(): string[] {
  return Object.keys(ERROR_CATALOG).sort();
}
