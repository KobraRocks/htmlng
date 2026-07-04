import { EngineError } from './types.js';

const ALLOWED_TAGS: Record<string, string[]> = {
  strong: [],
  b: [],
  em: [],
  i: [],
  a: ['href'],
  code: [],
  br: [],
  mark: [],
  del: [],
  ins: [],
  sub: [],
  sup: [],
  small: [],
};

const BLOCK_TAGS = new Set([
  'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'blockquote', 'table', 'tr', 'td', 'th',
  'section', 'article', 'header', 'footer', 'nav', 'main', 'aside',
]);

const TAG_RE = /<\/?(\w+)([^>]*)>/g;
const ATTR_RE = /(\w+)=/g;

export function validateText(value: string, file: string, field: string): void {
  let match: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;

  while ((match = TAG_RE.exec(value)) !== null) {
    const tagName = match[1].toLowerCase();
    const attrsStr = match[2];

    if (!ALLOWED_TAGS[tagName]) {
      if (BLOCK_TAGS.has(tagName)) {
        throw new EngineError(
          `Block-level tag <${tagName}> not allowed in text field. Use {{html:${field}}} for block-level content.`,
          file, field, 'ERROR',
        );
      }
      throw new EngineError(
        `Disallowed tag <${tagName}> in text field.`,
        file, field, 'ERROR',
        `Allowed inline tags: ${Object.keys(ALLOWED_TAGS).map(t => `<${t}>`).join(', ')}`,
      );
    }

    const allowedAttrs = ALLOWED_TAGS[tagName];
    if (allowedAttrs.length === 0 && attrsStr.trim()) {
      throw new EngineError(
        `Tag <${tagName}> does not allow any attributes in text field.`,
        file, field, 'ERROR',
      );
    }

    let attrMatch: RegExpExecArray | null;
    ATTR_RE.lastIndex = 0;
    while ((attrMatch = ATTR_RE.exec(attrsStr)) !== null) {
      const attrName = attrMatch[1].toLowerCase();
      if (!allowedAttrs.includes(attrName)) {
        throw new EngineError(
          `Disallowed attribute "${attrName}" on <${tagName}> in text field.`,
          file, field, 'ERROR',
          allowedAttrs.length > 0
            ? `Allowed attributes on <${tagName}>: ${allowedAttrs.join(', ')}.`
            : `Tag <${tagName}> does not allow any attributes.`,
        );
      }
    }
  }
}
