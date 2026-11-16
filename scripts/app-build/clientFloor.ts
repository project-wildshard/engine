/** Main can still name the previous release while the next release branch ships. */
export function clientFloor(version: string): string {
  const floor = '0.1.31', current = version.split('.').map(Number), minimum = floor.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const own = current[i] ?? 0, required = minimum[i] ?? 0;
    if (own !== required) return own < required ? version : floor;
  }
  return floor;
}
