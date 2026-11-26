/** WR8b retired epoch 1 at 0.1.36. J492 and WR15 retire older clients at the 0.1.73 wire rollout.
 *  Each floor applies from its own release onward, so main's earlier version can still boot while the release cuts. */
export function clientFloor(version: string): string {
  const current = version.split('.').map(Number);
  for (const floor of ['0.1.73', '0.1.36']) {
    const minimum = floor.split('.').map(Number);
    const difference = (current[0] ?? 0) - (minimum[0] ?? 0)
      || (current[1] ?? 0) - (minimum[1] ?? 0)
      || (current[2] ?? 0) - (minimum[2] ?? 0);
    if (difference >= 0) return floor;
  }
  return version;
}
