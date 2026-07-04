import { describe, it, expect } from 'vitest';
import { validateText } from '../src/text-validator.js';
import { EngineError } from '../src/types.js';

const F = 'data/test/page.yaml';
const K = 'heading';

describe('validateText', () => {
  it('passes plain text', () => {
    expect(() => validateText('Hello World', F, K)).not.toThrow();
  });

  it('passes whitelisted inline tags', () => {
    expect(() => validateText('Hello <strong>World</strong>', F, K)).not.toThrow();
    expect(() => validateText('Hello <em>World</em>', F, K)).not.toThrow();
    expect(() => validateText('Hello <b>Bold</b> <i>Italic</i>', F, K)).not.toThrow();
    expect(() => validateText('Line 1<br>Line 2', F, K)).not.toThrow();
    expect(() => validateText('<a href="/">link</a>', F, K)).not.toThrow();
    expect(() => validateText('<code>const x = 1;</code>', F, K)).not.toThrow();
    expect(() => validateText('<mark>highlight</mark>', F, K)).not.toThrow();
    expect(() => validateText('<del>old</del> <ins>new</ins>', F, K)).not.toThrow();
    expect(() => validateText('<sub>sub</sub> <sup>sup</sup>', F, K)).not.toThrow();
    expect(() => validateText('<small>tiny</small>', F, K)).not.toThrow();
  });

  it('rejects disallowed tags', () => {
    expect(() => validateText('Hello <script>x</script>', F, K))
      .toThrow(EngineError);
  });

  it('rejects disallowed attributes on <a>', () => {
    expect(() => validateText('<a href="/" onclick="x">link</a>', F, K))
      .toThrow(EngineError);
  });

  it('rejects attributes on tags that allow none', () => {
    expect(() => validateText('<strong class="bold">text</strong>', F, K))
      .toThrow(EngineError);
  });

  it('rejects block-level tags with a specific message', () => {
    expect(() => validateText('<div>block</div>', F, K))
      .toThrow(EngineError);
    try {
      validateText('<div>block</div>', F, K);
    } catch (e) {
      expect((e as EngineError).message).toContain('Block-level tag');
      expect((e as EngineError).message).toContain('{{html:heading}}');
    }
  });

  it('escaped angle brackets pass (no tag detected)', () => {
    // Literal &lt;strong&gt; is just text, not a tag
    expect(() => validateText('Hello &lt;strong&gt;World&lt;/strong&gt;', F, K)).not.toThrow();
  });
});
