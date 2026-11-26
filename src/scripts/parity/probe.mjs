/** Harness-only compatibility for historical pages; never copies or retains the level world. */
export function installLegacyProbeAdapter() {
  document.addEventListener('ws:ready', () => {
    const probe = /** @type {unknown} */ (window.__wildshard);
    if (typeof probe !== 'object' || probe === null) return; // The renderer-free title has no level probe.
    if (typeof Reflect.get(probe, 'requireWorld') === 'function') return;
    Reflect.set(probe, 'requireWorld', () => {
      const world = window.__wildshard.world;
      if (world === undefined) throw new Error('Debug level has retired');
      return world;
    });
  }, { once: true, capture: true });
}
