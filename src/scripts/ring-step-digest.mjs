import { createHash } from 'node:crypto';

const v5 = '{"format":"sim.snapshot","version":5,"snapshot":{"version":5,';
const v6 = '{"format":"sim.snapshot","version":6,"snapshot":{"version":6,';

/** Ring 1 compares the exact simulation, independent of v6's save header.
 * Hash the rest of the wire verbatim, including pending credit when present
 * and numeric spellings such as signed zero.
 * @param {string} previous @param {string} snapshot
 */
export function ringStepDigest(previous, snapshot) {
  const hash = createHash('sha256').update(previous);
  if (snapshot.startsWith(v6)) hash.update(v5).update(snapshot.slice(v6.length));
  else hash.update(snapshot);
  return hash.digest('hex');
}
