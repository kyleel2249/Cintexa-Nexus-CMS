// Minimal strict schema validator (no dependencies) used for agent inputs/outputs and tool args.
export type Schema =
  | { type: 'any' }
  | { type: 'string'; min?: number; max?: number; enum?: readonly string[] }
  | { type: 'number'; min?: number; max?: number; int?: boolean }
  | { type: 'boolean' }
  | { type: 'array'; items: Schema; max?: number }
  | { type: 'object'; props: Record<string, Schema>; optional?: readonly string[]; loose?: boolean };

export const S = {
  any: { type: 'any' } as Schema,
  str: (o: { min?: number; max?: number; enum?: readonly string[] } = {}): Schema => ({ type: 'string', ...o }),
  num: (o: { min?: number; max?: number; int?: boolean } = {}): Schema => ({ type: 'number', ...o }),
  bool: { type: 'boolean' } as Schema,
  arr: (items: Schema, max = 1000): Schema => ({ type: 'array', items, max }),
  obj: (props: Record<string, Schema>, optional: readonly string[] = [], loose = false): Schema =>
    ({ type: 'object', props, optional, loose }),
};

export function validate(schema: Schema, value: unknown, path = '$'): string[] {
  const errs: string[] = [];
  switch (schema.type) {
    case 'any': return errs;
    case 'string':
      if (typeof value !== 'string') return [`${path}: expected string`];
      if (schema.min !== undefined && value.length < schema.min) errs.push(`${path}: shorter than ${schema.min}`);
      if (schema.max !== undefined && value.length > schema.max) errs.push(`${path}: longer than ${schema.max}`);
      if (schema.enum && !schema.enum.includes(value)) errs.push(`${path}: not one of ${schema.enum.join('|')}`);
      return errs;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return [`${path}: expected finite number`];
      if (schema.int && !Number.isInteger(value)) errs.push(`${path}: expected integer`);
      if (schema.min !== undefined && value < schema.min) errs.push(`${path}: below ${schema.min}`);
      if (schema.max !== undefined && value > schema.max) errs.push(`${path}: above ${schema.max}`);
      return errs;
    case 'boolean':
      return typeof value === 'boolean' ? errs : [`${path}: expected boolean`];
    case 'array':
      if (!Array.isArray(value)) return [`${path}: expected array`];
      if (schema.max !== undefined && value.length > schema.max) errs.push(`${path}: more than ${schema.max} items`);
      value.forEach((v, i) => errs.push(...validate(schema.items, v, `${path}[${i}]`)));
      return errs;
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return [`${path}: expected object`];
      const obj = value as Record<string, unknown>;
      const optional = new Set(schema.optional ?? []);
      for (const [k, s] of Object.entries(schema.props)) {
        if (obj[k] === undefined) { if (!optional.has(k)) errs.push(`${path}.${k}: required`); continue; }
        errs.push(...validate(s, obj[k], `${path}.${k}`));
      }
      if (!schema.loose) for (const k of Object.keys(obj)) if (!(k in schema.props)) errs.push(`${path}.${k}: unknown key`);
      return errs;
    }
  }
}
