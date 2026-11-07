// oxlint-disable-next-line import/no-nodejs-modules -- Read the tracked predecessor header without importing JSON into the compiler.
import { readFileSync } from 'node:fs';
import { parseMoverRows } from '../../src/sharddev/movers';

/** Exact independent predecessor field order for the complete wire hash control. */
export function originalDriftwoodMoverTransport(): unknown {
  const value: unknown = JSON.parse(readFileSync(new URL('../../src/shards/driftwood-isle/data/movers.generated.json', import.meta.url), 'utf8'));
  return value;
}
/** Admit numeric rows through the defining grammar; native production calls its constructor. */
export function originalDriftwoodMovers(): ReturnType<typeof parseMoverRows> {
  return parseMoverRows(originalDriftwoodMoverTransport());
}
