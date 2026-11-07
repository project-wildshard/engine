/** Index already admitted native specs in first-seen order without copying their
 * bodies. Repeated identities must retain the same complete wire value. */
export function headlessSpecCatalogue<Spec extends { readonly kind: string; readonly variant: string }>(specs: Iterable<Spec>): ReadonlyMap<string, Spec> {
  const catalogue = new Map<string, Spec>();
  for (const spec of specs) {
    const key = `${spec.kind}.${spec.variant}`, previous = catalogue.get(key);
    if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(spec)) throw new Error(`Divergent native spec ${key}`);
    catalogue.set(key, spec);
  }
  return catalogue;
}
