/** Explicit checked named-JSON capability for Node author bundles. */
export type NamedJsonCheck = (schema: Readonly<Record<string, unknown>>, bytes: Uint8Array, pause: () => Promise<void>) => Promise<unknown>;

/** A page reads build-validated, hash-verified JSON. Unknown schemas are not
 * compiled there; ordinary Node readers retain their defining validator. */
export const readCheckedNamedJson: NamedJsonCheck = async (schema, bytes, pause) => {
  if (!(import.meta.env?.SSR ?? true)) throw new Error('Shardfile needs server validation before client admission');
  return (await import('./customSchema')).validateNamedJsonSchemaPaced(schema, bytes, pause);
};
