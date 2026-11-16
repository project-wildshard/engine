import * as THREE from 'three';
import type { SkyBackdropFactory } from '@wildshard/engine/render/look';
import { TOON_DAY_PRESET, type ToonLookRow } from '@wildshard/format/toonLook';
import type { ShardFolder } from '../../../shared/game/shardfile/shardFolder';
import { dayClock } from '../../../shared/game/looks/dayClock';
import { driveDayLight, runDayClock } from './daySky';
import { graphDaySkyBackdrop } from './graphDaySky';
import type { ColourRampFog } from '@wildshard/engine/world/Atmosphere';
import { toonLighting } from './toonLighting';

/** The cumulus: one icosahedron of `detail` subdivisions instanced per puff row `[x, y, z, r, puff, cluster, baseY]` (`aPuff` centre + radius,
 *  `aLump` phases + base cut); its graph lumps, squashes and turns each puff. */
export function cumulusGeometry(puffs: readonly (readonly number[])[], detail = 1): THREE.InstancedBufferGeometry {
  if (puffs.length === 0 || puffs.some(row => row.length !== 7)) throw new Error('faceted sky: the cumulus rows must be [x, y, z, r, puff, cluster, baseY]');
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.IcosahedronGeometry(1, detail).getAttribute('position'));
  geo.setAttribute('aPuff', new THREE.InstancedBufferAttribute(new Float32Array(puffs.flatMap(row => row.slice(0, 4))), 4));
  geo.setAttribute('aLump', new THREE.InstancedBufferAttribute(new Float32Array(puffs.flatMap(row => row.slice(4))), 3));
  geo.instanceCount = puffs.length;
  return geo;
}

/** Internal client-only graph toon sky. Geometry, clock, palette and graph/channel identities are declared as data. */
export function toonSkyBackdrop(product: ShardFolder, row: ToonLookRow, rampFog: ColourRampFog): SkyBackdropFactory {
  const day = dayClock(TOON_DAY_PRESET, row.sky.day, { dusk: 'dusk' });
  const dayLight = toonLighting(row.lighting);
  const style = day.style, mid = row.sky.midday, rgb = (c: readonly [number, number, number]): THREE.Color => new THREE.Color(...c);
  const startSun = new THREE.Vector3(...style.startSun).normalize(), second = style.frames[1]?.[1] ?? style.frames[0]?.[1], first = day.presets[second ?? ''];
  if (first === undefined) throw new Error('faceted day: keys missing');
  return graphDaySkyBackdrop({ name: row.sky.name, source: product.shardfile, ids: [row.sky.dome.look, row.sky.clouds.look], dome: { graph: row.sky.dome.look, radius: row.sky.dome.radius, segments: row.sky.dome.segments, order: row.sky.dome.order }, channels: row.sky.channels, build: (context, g, dome) => {
    const { sky, scene, level } = context, envScene = new THREE.Scene().add(new THREE.Mesh(dome.geometry, dome.material)), cloudMaterial = g.material(row.sky.clouds.look);
    sky.sunDir.copy(startSun); g.setParam(row.sky.dome.look, 'sunDir', startSun.toArray()); // the first (offscreen) environment's sun
    cloudMaterial.toneMapped = false;
    const clouds = new THREE.Mesh(cumulusGeometry(row.sky.clouds.puffs, row.sky.clouds.detail), cloudMaterial);
    clouds.frustumCulled = false; clouds.renderOrder = row.sky.clouds.order; dome.add(clouds); // drawn after the world (depth-tested against it)
    scene.environmentIntensity = level.sky.envIntensity;
    rampFog.zenith.value.copy(rgb(mid.zenith)); // the colour-ramp fog fades into the dome's own gradient
    const clock = runDayClock(day, row.sky.cycleSeconds), P = day.clone(first), sun = new THREE.Vector3(), moon = new THREE.Vector3();
    const sunIScale = level.sky.sunIntensity / style.sunIBase, shadowStep = style.shadowStepDeg * (Math.PI / 180);
    const palette = { uHorizon: { value: rgb(mid.horizon) }, uCloudLit: { value: rgb(mid.cloudLit) }, uSunGlow: { value: rgb(mid.sunGlow) }, uSunDir: { value: startSun.clone() } };
    return Promise.resolve({
      clock, follow: false, horizon: rgb(mid.horizon),
      // one owner for the environment (SF57): a grid region builds this backdrop as a layer each time it is admitted (G223).
      // G913: stepped, one PMREM step a frame; the whole refresh drew its 6 faces and GGX passes in one frame (+22 draws)
      environment: { source: { kind: 'scene', scene: envScene, size: style.envSize, near: row.sky.environment.near, far: row.sky.environment.far }, refresh: { every: style.envRefresh, stepped: true }, offscreenFirst: true },
      owners: new Map<string, unknown>([['preset', P], ['palette.horizon', palette.uHorizon], ['palette.cloudLit', palette.uCloudLit], ['palette.sunGlow', palette.uSunGlow], ['palette.sunDir', palette.uSunDir],
        ['light.night', dayLight.uToonNight], ['light.lift', dayLight.uToonLift], ['light.rim', dayLight.uToonRim], ['light.cloudShadow', dayLight.uCloudShadow], ['fog.near', rampFog.near], ['fog.zenith', rampFog.zenith]]),
      // the clean chain: no post the clock turns; it steps its own shadow light, so it runs after the cascades
      drive: (T, _post, snap) => {
        if (T === null) return;
        const p = clock.phase;
        clock.key(P); clock.sunAt(sun); clock.moonAt(moon);
        driveDayLight(T, day, p, sun, moon, P, sunIScale, shadowStep, snap, T.shadowBusy);
      },
      tick: (dt) => { dayLight.uCloudTime.value += dt; },
      bound: (T) => { T.planet.uCrisp.value = row.sky.crisp; }, // a crisp, opaque disc against the faceted dome
      backdrop: { updateAt: 'late', fadesPlanet: false, palette: { ...palette, middayLit: rgb(mid.cloudLit) } },
    });
  } });
}
