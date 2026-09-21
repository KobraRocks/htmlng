import { EngineError } from './types.js';
import { unsafeUrlReason } from './url-safety.js';

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
          file, field, 'ERROR', undefined, 'TEXT_BLOCK_TAG',
        );
      }
      throw new EngineError(
        `Disallowed tag <${tagName}> in text field.`,
        file, field, 'ERROR',
        `Allowed inline tags: ${Object.keys(ALLOWED_TAGS).map(t => `<${t}>`).join(', ')}`,
        'TEXT_TAG_DISALLOWED',
      );
    }

    const allowedAttrs = ALLOWED_TAGS[tagName];
    if (allowedAttrs.length === 0 && attrsStr.trim()) {
      throw new EngineError(
        `Tag <${tagName}> does not allow any attributes in text field.`,
        file, field, 'ERROR', undefined, 'TEXT_ATTR_DISALLOWED',
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
          'TEXT_ATTR_DISALLOWED',
        );
      }
    }

    // Scheme check for <a href="..."> — the whitelist allows the tag, not any URL
    if (tagName === 'a') {
      const hrefMatch = attrsStr.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
      if (hrefMatch) {
        const href = hrefMatch[1] ?? hrefMatch[2] ?? hrefMatch[3] ?? '';
        const reason = unsafeUrlReason(href);
        if (reason) {
          throw new EngineError(
            `Unsafe href in text field: ${reason}`,
            file, field, 'ERROR',
            'Use an http(s), mailto, tel, fragment (#...), or relative URL.',
            'UNSAFE_URL',
          );
        }
      }
    }
  }
}
