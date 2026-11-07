import { Color } from 'three';
import type { ToonLook } from '@wildshard/engine/render/families/toon';
import type { ToonLightingRow } from '@wildshard/format/toonLighting';

function createLighting(row: ToonLightingRow['initial']) : { uToonLift: { value: Color; }; uToonRim: { value: Color; }; uCloudShadow: { value: number; }; uToonNight: { value: number; }; uSeaLevel: { value: number; }; uCloudTime: { value: number; }; } {
  return { uToonLift: { value: new Color(...row.uToonLift) }, uToonRim: { value: new Color(...row.uToonRim) },
    uCloudShadow: { value: row.uCloudShadow }, uToonNight: { value: row.uToonNight },
    uSeaLevel: { value: row.uSeaLevel }, uCloudTime: { value: row.uCloudTime } };
}
const lighting = new Map<string, ReturnType<typeof createLighting>>();
/** Session-called admission. Sky, terrain, streamed plants and held meshes share this row identity. */
export function toonLighting(row: ToonLightingRow): ReturnType<typeof createLighting> {
  let state = lighting.get(row.id);
  if (state === undefined) { state = createLighting(row.initial); lighting.set(row.id, state); }
  return state;
}
/** Resolve an admitted lighting id, refusing a client that skipped preparation. */
export function toonLightingOf(id: string): ReturnType<typeof createLighting> {
  const state = lighting.get(id);
  if (state === undefined) throw new Error(`Toon lighting requires admission: ${id}`);
  return state;
}
/** Platform material binding; the host owns the follow, never a shard callback. */
export function followToonLighting(id: string, look: ToonLook): () => void {
  const u = toonLightingOf(id), t = look.uniforms;
  return () => { t.famToonLift.value.copy(u.uToonLift.value); t.famToonRim.value.copy(u.uToonRim.value);
    t.famToonCloud.value.x = u.uCloudShadow.value; t.famToonWater.value.x = u.uSeaLevel.value; t.famToonTime.value = u.uCloudTime.value; };
}
