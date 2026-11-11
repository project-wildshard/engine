/** Explicit checked named-JSON capability for Node author bundles. */
export type NamedJsonCheck = ((schema: Readonly<Record<string, unknown>>, bytes: Uint8Array, pause: () => Promise<void>) => Promise<unknown>)
  /** The same schema and bytes always decode to the same value (TEST-SPEED TS4): a product may then skip its platform and
   * registered checks on a name that already passed. A checker without it is re-checked on every read. */
  & { readonly pure?: true };

/** A page reads build-validated, hash-verified JSON. Unknown schemas are not
 * compiled there; ordinary Node readers retain their defining validator. */
export const readCheckedNamedJson: NamedJsonCheck = Object.assign(async (schema: Readonly<Record<string, unknown>>, bytes: Uint8Array, pause: () => Promise<void>) => {
  if (!(import.meta.env?.SSR ?? true)) throw new Error('Shardfile needs server validation before client admission');
  return (await import('./customSchema')).validateNamedJsonSchemaPaced(schema, bytes, pause);
}, { pure: true as const });
