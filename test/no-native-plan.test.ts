// FORMAT-PRUNE FP21 gate: the engine no longer reads `server/native-assembly.json`, so no pinned shard may ship one. Every
// pin in `test/pins/shardfiles.json` is read from its built product's `shard.json` (`admission.server`); a pin that still
// names the plan file fails here, by slug and revision, until it is republished from a source that writes `server/world`
// and its family sections (Driftwood, Pine and Nalati, FP16) and re-pinned.
// oxlint-disable-next-line import/no-nodejs-modules -- The gate reads each pinned product's shard.json.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { builtFolder } from '../src/test/game/builtFolder';

const PLAN_FILE = 'server/native-assembly.json';
interface PinRow { readonly slug: string; readonly uploadNumber: number }

test('no pinned shard ships a native plan file (FP21)', () => {
  const pins = (JSON.parse(readFileSync('test/pins/shardfiles.json', 'utf8')) as { shards: readonly PinRow[] }).shards;
  expect(pins.length).toBeGreaterThan(0);
  const shipping = pins.flatMap(pin => {
    const shard = JSON.parse(readFileSync(`${builtFolder(pin.slug)}/shard.json`, 'utf8')) as { admission?: { server?: readonly { readonly name?: string }[] } };
    return (shard.admission?.server ?? []).some(row => row.name === PLAN_FILE) ? [`${pin.slug} r${pin.uploadNumber}`] : [];
  });
  expect(shipping, `pinned shards still ship ${PLAN_FILE}`).toEqual([]);
});
