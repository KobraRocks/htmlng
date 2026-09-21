import type { PlaceholderSchema } from './types.js';

export interface SchemaValidationResult {
  valid: boolean;
  errors: string[];
}

type Def = PlaceholderSchema[string];
type SubType = 'string' | 'number' | 'object';

interface SubField {
  name: string;
  required: boolean;
  type: SubType;
}

/**
 * Sub-fields the template renderer dereferences for object-shaped placeholders.
 * These are required because `template.ts` reads them directly (e.g. `v.href`),
 * so a missing value would otherwise surface as an internal TypeError.
 */
const SUB_FIELDS: Partial<Record<Def['type'], SubField[]>> = {
  image: [
    { name: 'src', required: true, type: 'string' },
    { name: 'alt', required: false, type: 'string' },
    { name: 'width', required: false, type: 'number' },
    { name: 'height', required: false, type: 'number' },
    { name: 'loading', required: false, type: 'string' },
    { name: 'class', required: false, type: 'string' },
  ],
  link: [
    { name: 'href', required: true, type: 'string' },
    { name: 'label', required: true, type: 'string' },
    { name: 'class', required: false, type: 'string' },
  ],
  slot: [
    { name: 'component', required: true, type: 'string' },
    { name: 'data', required: false, type: 'object' },
  ],
};

const TYPE_LABEL: Record<Def['type'], string> = {
  text: 'string',
  html: 'string',
  bool: 'boolean',
  image: 'object',
  link: 'object',
  slot: 'object',
  list: 'array',
};

function actualType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate one data object against a component's placeholder schema.
 *
 * This is a deliberately small, hand-rolled validator covering exactly the
 * dialect the engine supports: `type`, `required`, `maxLength`, plus the
 * object sub-fields (image/link/slot) that the template renderer dereferences.
 * Extra keys are permitted here and reported as warnings by `validatePageData`.
 */
export function validateData(
  schema: PlaceholderSchema,
  data: Record<string, unknown>,
): SchemaValidationResult {
  const errors: string[] = [];

  for (const [name, def] of Object.entries(schema)) {
    const value = data[name];
    const path = `/${name}`;

    if (value === undefined) {
      if (def.required) errors.push(`(root) must have required property '${name}'`);
      continue;
    }

    const expected = TYPE_LABEL[def.type];
    const matches =
      expected === 'array' ? Array.isArray(value)
      : expected === 'object' ? isPlainObject(value)
      : typeof value === expected;

    if (!matches) {
      errors.push(`${path} must be ${expected} (got ${actualType(value)})`);
      continue;
    }

    if (def.maxLength !== undefined && typeof value === 'string' && value.length > def.maxLength) {
      errors.push(`${path} must NOT have more than ${def.maxLength} characters`);
    }

    const subFields = SUB_FIELDS[def.type];
    if (subFields && isPlainObject(value)) {
      for (const sub of subFields) {
        const subValue = value[sub.name];
        const subPath = `${path}/${sub.name}`;

        if (subValue === undefined) {
          if (sub.required) errors.push(`${path} must have required property '${sub.name}'`);
          continue;
        }

        const subMatches =
          sub.type === 'object' ? isPlainObject(subValue) : typeof subValue === sub.type;
        if (!subMatches) {
          errors.push(`${subPath} must be ${sub.type} (got ${actualType(subValue)})`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
