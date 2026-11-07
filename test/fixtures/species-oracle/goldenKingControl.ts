import { originalSpeciesJson } from '../nalati-original-species';
import * as v from 'valibot';
// Original species controls frozen before removal of the test-only override API.
// Source: ac921ef953aed56e11255743a8a0bb6df3658cc8:src/shards/nalati-grasslands/species/goldenKing.ts
import { arenaRoomBrain } from '../../../src/server/game/boss/arenaRoomFight';
import type { Animal } from '../../../src/client/engine/entities/AnimalView';
import type { SpeciesDef,ThinkCtx } from '../../../src/shared/engine/entities/species/registry';
import type { Vector3 } from 'three';

const speciesRows = v.parse(v.object({ king: v.object({ kind: v.string() }) }), originalSpeciesJson('boot.json'));
export const GOLDEN_KING = speciesRows.king.kind;
export interface GoldenKingPorts {
  think: (a: Animal, c: ThinkCtx) => void; act: (a: Animal, c: ThinkCtx) => void;
  damageMul: (a: Animal, point: Vector3, direction: Vector3) => number;
}
const kingBrains = new WeakMap<Animal, GoldenKingPorts>();
export function bindGoldenKing(a: Animal, ports: GoldenKingPorts): void { kingBrains.set(a, ports); }
/** The Golden King's page controls; his body, rig, look and tick are the look book's rows. */
export const GOLDENKING_SPECIES: Pick<SpeciesDef, 'kind' | 'think' | 'act' | 'damageMul'> = {
  kind: GOLDEN_KING,
  think: (a, c) => {
    const m = a.mem;
    if (m['init'] !== 1) { m['init'] = 1; m['pose'] ??= 0; m['rise'] ??= 0; m['cape'] ??= 1; m['crown'] ??= 1; m['floorY'] ??= c.heightAt(a.position.x, a.position.z); }
    (kingBrains.get(a) ?? arenaRoomBrain(a))?.think(a, c);
  },
  act: (a, c) => { (kingBrains.get(a) ?? arenaRoomBrain(a))?.act(a, c); },
  damageMul: (a, point, direction) => (kingBrains.get(a) ?? arenaRoomBrain(a))?.damageMul(a, point, direction) ?? 1,
};
