/** Ignore only telemetry-only SaveStore envelope writes; reads and mixed gameplay writes remain observed.
 * @param {string|null} before @param {string} after @param {string} key */
export function telemetryOnlyWrite(before, after, key) {
  if (!/^wildshard\.save\.v2\.(device|session)$/.test(key)) return false;
  try {
    const previous = JSON.parse(before ?? '{"keys":{}}'), next = JSON.parse(after);
    if (!previous || !next || typeof previous !== 'object' || typeof next !== 'object' ||
      !previous.keys || !next.keys || typeof previous.keys !== 'object' || typeof next.keys !== 'object') return false;
    if (JSON.stringify({ ...previous, keys: null }) !== JSON.stringify({ ...next, keys: null })) return false;
    const changed = [...new Set([...Object.keys(previous.keys), ...Object.keys(next.keys)])]
      .filter((id) => JSON.stringify(previous.keys[id]) !== JSON.stringify(next.keys[id]));
    return changed.length > 0 && changed.every((id) => id.startsWith('telemetry.') || id === 'life.alive' || id === 'err.queue');
  } catch { return false; }
}
