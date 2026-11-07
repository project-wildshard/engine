/** Placement-height port. Collision queries still use the physics world. */
let sample: (x: number, z: number) => number = () => 0;
export function setTerrainHeight(fn: (x: number, z: number) => number): void { sample = fn; }
export function terrainHeight(x: number, z: number): number { return sample(x, z); }

let normal: (x: number, z: number) => [number, number, number] = () => [0, 1, 0];
let water: () => number = () => -1000;
export function setTerrainPlacement(normalFn: typeof normal, waterFn: typeof water): void { normal = normalFn; water = waterFn; }
export function terrainNormal(x: number, z: number): [number, number, number] { return normal(x, z); }
export function terrainWaterLevel(): number { return water(); }

let datum: () => number = () => 0;
/** Bind the level's vertical datum (its terrain field's `datum`: a level shifted up or down at runtime, 0 for every level
 *  that isn't). Heightfield binds it; nothing else should. */
export function setTerrainDatum(fn: () => number): void { datum = fn; }
/** How far the level's world is shifted vertically at runtime (Driftwood's G164 drop with its hybrid row ON: −0.8). Readers
 *  that keep a pose or a mesh in the level's authored frame (a `?at=` reload, the baked navmesh) add it on the way in and
 *  take it off on the way out, so the same saved pose stands on the same ground in either state. */
export function terrainDatum(): number { return datum(); }
