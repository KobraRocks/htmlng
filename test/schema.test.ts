import { describe, it, expect } from 'vitest';
import { validateData } from '../src/schema.js';
import type { PlaceholderSchema } from '../src/types.js';

describe('validateData — scalar types', () => {
  const schema: PlaceholderSchema = {
    heading: { type: 'text', required: true, maxLength: 10 },
    body: { type: 'html' },
    show: { type: 'bool' },
    items: { type: 'list' },
  };

  it('accepts a well-formed object', () => {
    const result = validateData(schema, {
      heading: 'Short',
      body: '<p>x</p>',
      show: true,
      items: [{ a: 1 }],
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('reports a missing required property', () => {
    const result = validateData(schema, { body: 'x' });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("(root) must have required property 'heading'");
  });

  it('reports a type mismatch with the actual type', () => {
    const result = validateData(schema, { heading: 123 });
    expect(result.errors).toContain('/heading must be string (got number)');
  });

  it('rejects null for a present field', () => {
    const result = validateData(schema, { heading: null });
    expect(result.errors).toContain('/heading must be string (got null)');
  });

  it('enforces maxLength', () => {
    const result = validateData(schema, { heading: 'way too long for the limit' });
    expect(result.errors).toContain('/heading must NOT have more than 10 characters');
  });

  it('allows unknown extra keys (reported as warnings elsewhere)', () => {
    const result = validateData(schema, { heading: 'ok', unexpected: 'value' });
    expect(result.valid).toBe(true);
  });
});

describe('validateData — object sub-fields', () => {
  it('requires href and label on link', () => {
    const schema: PlaceholderSchema = { cta: { type: 'link' } };
    expect(validateData(schema, { cta: { label: 'Go' } }).errors)
      .toContain("/cta must have required property 'href'");
    expect(validateData(schema, { cta: { href: '/x' } }).errors)
      .toContain("/cta must have required property 'label'");
    expect(validateData(schema, { cta: { href: '/x', label: 'Go' } }).valid).toBe(true);
  });

  it('requires src on image and validates optional field types', () => {
    const schema: PlaceholderSchema = { pic: { type: 'image' } };
    expect(validateData(schema, { pic: { alt: 'a' } }).errors)
      .toContain("/pic must have required property 'src'");
    expect(validateData(schema, { pic: { src: 'a.webp', width: '800' } }).errors)
      .toContain('/pic/width must be number (got string)');
    expect(validateData(schema, { pic: { src: 'a.webp', width: 800, loading: 'lazy' } }).valid).toBe(true);
  });

  it('requires component on slot and type-checks slot data', () => {
    const schema: PlaceholderSchema = { child: { type: 'slot' } };
    expect(validateData(schema, { child: {} }).errors)
      .toContain("/child must have required property 'component'");
    expect(validateData(schema, { child: { component: 'card', data: 'nope' } }).errors)
      .toContain('/child/data must be object (got string)');
    expect(validateData(schema, { child: { component: 'card', data: { title: 'x' } } }).valid).toBe(true);
  });

  it('rejects an array where an object is expected', () => {
    const schema: PlaceholderSchema = { cta: { type: 'link' } };
    expect(validateData(schema, { cta: [] }).errors)
      .toContain('/cta must be object (got array)');
  });
});
