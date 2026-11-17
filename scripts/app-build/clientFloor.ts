/** Main can still name the previous release while the next release branch ships. 0.1.36 is the first save-epoch-2 client
 *  (WR8b): every older client is forced over once (J383), so no device plays epoch-1 progress against an epoch-2 server. */
export function clientFloor(version: string): string {
  const floor = '0.1.36', current = version.split('.').map(Number), minimum = floor.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const own = current[i] ?? 0, required = minimum[i] ?? 0;
    if (own !== required) return own < required ? version : floor;
  }
  return floor;
}
