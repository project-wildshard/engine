/** ONE-FORMAT OF18c (J365 (4), Q-S13): `debug.expose` hands a page's runtime objects to the window for tests and tools.
 * A plain upload to production may not carry it: the activation refuses the upload by name before it is placed. Staging
 * and preview keep it. (The built-in pins that still expose debug handles on production lose them as M8 moves each
 * shard onto the plain upload path.) */
export function refuseProductionDebug(plan: unknown): void {
  const features: unknown = typeof plan === 'object' && plan !== null ? Reflect.get(plan, 'features') : undefined;
  if (!Array.isArray(features)) return;
  const names = features.flatMap((row: unknown) => typeof row === 'object' && row !== null && Reflect.get(row, 'kind') === 'debug.expose'
    ? [String(Reflect.get(row, 'name'))] : []);
  if (names.length > 0) throw new Error(`debug.expose is refused on production: ${names.join(', ')}`);
}
