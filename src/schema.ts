import { Ajv } from 'ajv';
import type { PlaceholderSchema } from './types.js';

const ajv = new Ajv({ allErrors: true, strict: false });

export function validateData(
  schema: PlaceholderSchema,
  data: Record<string, unknown>,
): { valid: boolean; errors: string[] } {
  const properties: Record<string, Record<string, unknown>> = {};
  const required: string[] = [];

  for (const [name, def] of Object.entries(schema)) {
    const prop: Record<string, unknown> = {};
    switch (def.type) {
      case 'text': case 'html': prop.type = 'string'; break;
      case 'bool': prop.type = 'boolean'; break;
      case 'image': case 'link': case 'slot': prop.type = 'object'; break;
      case 'list': prop.type = 'array'; break;
    }
    if (def.maxLength !== undefined) prop.maxLength = def.maxLength;
    properties[name] = prop;
    if (def.required) required.push(name);
  }

  const jsonSchema = {
    type: 'object',
    properties,
    required: required.length > 0 ? required : undefined,
    additionalProperties: true,
  };

  const validate = ajv.compile(jsonSchema);
  const valid = validate(data);

  const errors: string[] = validate.errors
    ? validate.errors.map((e: { instancePath?: string; message?: string }) =>
        `${e.instancePath || '(root)'} ${e.message}`)
    : [];

  return { valid, errors };
}
