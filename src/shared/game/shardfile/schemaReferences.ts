const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Factor large inline draft-07 schemas without touching data-valued keywords.
 * Existing identifiers/references retain their original pointer and base-URI semantics. */
export function schemaReferences(schema: object, text: string): object {
  if (text.length < 16_384 || /"(?:\$ref|\$id|definitions)":/u.test(text)) return schema;
  const definitions: Record<string, unknown> = {}, seen = new Map<string, string>();
  const visit = (value: unknown, root = false): unknown => {
    if (!object(value)) return value;
    const out = { ...value };
    for (const key of ['properties', 'patternProperties', 'dependencies']) {
      const fields = out[key];
      if (object(fields)) out[key] = Object.fromEntries(Object.entries(fields).map(([name, entry]) => [name, visit(entry)]));
    }
    for (const key of ['additionalProperties', 'additionalItems', 'contains', 'propertyNames', 'not', 'if', 'then', 'else']) {
      if (key in out) out[key] = visit(out[key]);
    }
    if ('items' in out) out['items'] = Array.isArray(out['items']) ? out['items'].map(entry => visit(entry)) : visit(out['items']);
    for (const key of ['allOf', 'anyOf', 'oneOf']) {
      const entries = out[key];
      if (Array.isArray(entries)) out[key] = entries.map(entry => visit(entry));
    }
    if (root) return out;
    const encoded = JSON.stringify(out);
    if (encoded.length < 32) return out;
    let id = seen.get(encoded);
    if (id === undefined) { id = `ws${seen.size}`; seen.set(encoded, id); definitions[id] = out; }
    return { $ref: `#/definitions/${id}` };
  };
  const root = visit(schema, true);
  if (!object(root)) throw new Error('Schema root must be an object');
  return { ...root, definitions };
}
