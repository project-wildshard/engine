import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { zlibSync } from 'fflate';
import { expect, test } from 'vitest';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { emptyShardfile } from '../src/shared/host/author';
import { createShardfileSim } from '../src/server/game/plugin/simulation';

// ONE-FORMAT OF40b: `water.field` from a plain upload. A `world/field` pond raster, with no native host, stands water at
// its level where the pond samples above zero (Nalati's grass field law) and leaves the rest of the cell dry.
const LEVEL = 2, RES = 3, SIZE = 30;
const pondBytes = zlibSync(new Uint8Array(new Float32Array([-1, -1, -1, -1, -1, -1, 4, 4, 4]).buffer));
const pond = createHash('sha256').update(pondBytes).digest('hex');
const shard = { ...emptyShardfile({ slug: 'field-fixture', name: 'Field fixture', author: 'Test', revision: 1, seed: 5 }), spawn: { x: 0, y: 0, z: 0, yaw: 0 } };
const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));

test('OF40b: a plain world/field section stands water where the pond is, and nowhere else', () => {
  const sections = new Map<string, unknown>([['world/field', { level: LEVEL, res: RES, size: SIZE, pond }]]);
  const sim = createShardfileSim(shard, new Map([[pond, pondBytes]]), { rapier, sections });
  try {
    expect(sim.host.hasWater).toBe(true);
    expect(sim.host.waterSurfaceAt(0, 14)).toBe(LEVEL);
    expect(sim.host.waterSurfaceAt(0, -14)).toBe(null);
  } finally { sim.dispose(); }
});

test('OF40b: a field whose pond raster was not admitted is refused', () => {
  const sections = new Map<string, unknown>([['world/field', { level: LEVEL, res: RES, size: SIZE, pond }]]);
  expect(() => createShardfileSim(shard, new Map(), { rapier, sections })).toThrow('Field water requires its admitted pond raster');
});

test('OF40b: without a field section the host stays dry, as before', () => {
  const sim = createShardfileSim(shard, new Map(), { rapier });
  try { expect(sim.host.hasWater).toBe(false); } finally { sim.dispose(); }
});
