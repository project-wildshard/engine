/** ONE-FORMAT OF30: a declared species row's view projection (format `fbbd778c`), read as data so an older format's rows
 *  type it as absent; the first row of a kind with one wins. */
export function declaredProjections(species: readonly object[]): ReadonlyMap<string, unknown> {
  const out = new Map<string, unknown>();
  for (const row of species) {
    const kind: unknown = Reflect.get(row, 'kind'), projection: unknown = Reflect.get(row, 'projection');
    if (typeof kind === 'string' && projection !== undefined && !out.has(kind)) out.set(kind, projection);
  }
  return out;
}
