import { hashImmutableBytes } from '../../src/shared/host/immutable';
import { ecologyRows } from '../../src/shards/nalati-grasslands/generators/ecology.mjs';
import { BARREL_BODIES, BARREL_DECISION } from '../../src/shards/driftwood-isle/generators/barrelDecision';

/** Complete original ecology, body/floor and decision wires before SDK-port adoption. */
export function speciesBarrelAuthorObservation() {
  return Object.entries({ ecology: ecologyRows(), bodies: BARREL_BODIES, decision: BARREL_DECISION }).map(([name, value]) => {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    return { name, bytes: bytes.length, hash: hashImmutableBytes(bytes) };
  });
}
