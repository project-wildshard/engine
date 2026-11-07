import type { SkyBackdropPost, SkyBackdropTargets } from '@wildshard/engine/render/look';
import { setting } from '@wildshard/engine/ui/Settings';
import { DayCycle } from '@wildshard/engine/world/dayCycle';
import * as THREE from 'three';
import type { DayClock, DayCurves } from '../../../shared/game/looks/dayClock';
import type { DayLookPreset } from '../../../shared/game/looks/dayLookPresets';
import type { DayLookSchema } from '@wildshard/format/dayLook';

/**
 * A keyed day clock on a page (SHARD-PLATFORM W2 C2; Pine Hollow's keyed sky and Driftwood's faceted day): the backdrop's
 * side of `dayClock` — the clock started where the URL or Settings ▸ Time of day put it (`runDayClock`) and the scene's key
 * lights turned with it (`driveDayLight`). The clock itself stays renderer-free (`./dayClock`, the headless host's).
 */

/**
 * The clock a backdrop runs, at the URL's / Settings' time: Settings ▸ Time of day parks it at a pick (paused), else `?tod=`
 * (a phase, or a name of the row's `phases`) or the row's start; `?clock=` seconds a cycle (default `cycleSeconds`).
 * `curves` replace the row's (a backdrop that lays its weather over them).
 */
export function runDayClock<S extends DayLookSchema>(day: DayClock<S>, cycleSeconds: number, curves: DayCurves = day.spec.curves): DayCycle<DayLookPreset<S>> {
  const style = day.style, qs = new URLSearchParams(location.search);
  const todRaw = qs.get('tod') ?? '';
  const named = style.phases !== undefined && Object.hasOwn(style.phases, todRaw) ? style.phases[todRaw] : undefined;
  const tod = named ?? Number.parseFloat(todRaw), cycle = Number.parseFloat(qs.get('clock') ?? '');
  const time = setting('time'); // 'live' whenever ?tod / ?clock are in the URL
  const frozen = time !== 'live';
  const clock = new DayCycle({ ...day.spec, curves, start: frozen ? style.fixed[time] : Number.isFinite(tod) ? ((tod % 1) + 1) % 1 : style.start });
  clock.cycle = Number.isFinite(cycle) && cycle > 1 ? cycle : cycleSeconds;
  clock.paused = frozen;
  return clock;
}


/** The key light a preset sets: its colour and intensity (before the fade), the hemisphere fill. */
export interface DayLightRow { readonly light: THREE.Color; readonly lightI: number; readonly hemiSky: THREE.Color; readonly hemiGround: THREE.Color; readonly hemiI: number }

const want = new THREE.Vector3();
/**
 * The scene's key lights at phase p (the same lights, never added or removed): the light body (`sun` by day, `moon` by night)
 * as the sun direction and the fog's in-scatter direction, the shadow direction in `step`-radian steps (`snap`: at once — a
 * boot, a Time of day pick; `hold`: a step still crossfading waits), the CSM lights' colour and intensity × `scale` × the
 * fade, the hemisphere fill. Returns the fade.
 */
export function driveDayLight<S extends DayLookSchema>(T: SkyBackdropTargets, day: DayClock<S>, p: number, sun: THREE.Vector3, moon: THREE.Vector3, row: DayLightRow, scale: number, step: number, snap: boolean, hold?: () => boolean): number {
  const dir = p < day.style.dayFraction ? sun : moon, fade = day.fadeAt(p, sun);
  T.sunDir.copy(dir);
  want.copy(dir).negate();
  // the sun ↔ moon swap is one big step; a small one waits for the last one's fade
  if (snap || (want.angleTo(T.lightDirection) > step && !(hold?.() ?? false))) T.lightDirection.copy(want);
  for (const l of T.lights) { l.color.copy(row.light); l.intensity = row.lightI * scale * fade; }
  T.hemi.color.copy(row.hemiSky); T.hemi.groundColor.copy(row.hemiGround); T.hemi.intensity = row.hemiI;
  T.fogU.fogSunDir.value.copy(dir);
  return fade;
}

/** The air a keyed day preset sets beside its key light (field names as a day-look schema declares them, live colours). */
export interface DayAirRow {
  /** scene.environmentIntensity; the fog's sun in-scatter colour and its distance / height densities */
  readonly env: number; readonly fogSun: THREE.Color; readonly fogDist: number; readonly fogHeight: number;
  /** the disc's colour, the corona sprite's colour and opacity */
  readonly disc: THREE.Color; readonly halo: THREE.Color; readonly haloO: number;
  /** the cloud layer: its tint toward the light, its lit / shade multiplier, its opacity */
  readonly cloudSun: THREE.Color; readonly cloudLit: THREE.Color; readonly cloudA: number;
  /** the far ridges' haze, and the key light's colour (the far sea's glint) */
  readonly far: THREE.Color; readonly light: THREE.Color;
  /** the volumetric shafts' colour and strength, the god rays' opacity, the grade's saturation */
  readonly volColor: THREE.Color; readonly vol: number; readonly rays: number; readonly sat: number;
}

/** This frame's light body as the air reads it (a caller keeps one and refills it: nothing allocated a frame). */
export interface DayAirFrame {
  /** the fog's colour (the sky's horizon of the hour) */
  readonly fog: THREE.Color;
  /** the light body (the sun by day, the moon by night) and the direction the cloud layer is lit from */
  readonly body: THREE.Vector3; readonly cloudBody: THREE.Vector3;
  /** `driveDayLight`'s fade, the body above the horizon (0 … 1), the disc's scale and the corona's share of its opacity */
  readonly fade: number; readonly above: number; readonly discScale: number; readonly haloK: number;
}

const airTint = new THREE.Color();
/**
 * The air at the hour (beside `driveDayLight`): the scene's image-based light, the fog (its colour, sun in-scatter and
 * densities; left alone while the eye is under water, where the atmosphere owns it), the disc and its corona, the cloud
 * layer, the far ridges' haze and sea glint, and the post chain's shafts, god rays and saturation. Uniforms, colours and
 * intensities only: no program changes. Pine Hollow's keyed sky is its user; G441's W3 match is Nalati's `look/skyRig.ts`
 * `apply` (its environment, fog, disc, corona and cloud-light writes).
 */
export function driveDayAir(T: SkyBackdropTargets, post: SkyBackdropPost | null, scene: { environmentIntensity: number }, row: DayAirRow, f: DayAirFrame): void {
  scene.environmentIntensity = row.env;
  if (!T.underwater()) {
    T.fog.color.copy(f.fog);
    T.fogU.fogSunColor.value.copy(row.fogSun);
    T.fogU.fogDistDensity.value = row.fogDist;
    T.fogU.fogHeightDensity.value = row.fogHeight;
  }
  (T.disc.material as THREE.MeshBasicMaterial).color.copy(row.disc).multiplyScalar(f.above);
  T.disc.scale.setScalar(f.discScale);
  if (T.halo) { T.halo.material.color.copy(row.halo); T.halo.material.opacity = row.haloO * f.above * f.haloK; }
  T.cloud.uSunDir.value.copy(f.cloudBody);
  T.cloud.uSunColor.value.copy(row.cloudSun); T.cloud.uCloudLit.value.copy(row.cloudLit); T.cloud.uCloudAlpha.value = row.cloudA;
  T.far.uHazeCol.value.copy(row.far); T.far.uSeaSky.value.copy(row.far).multiplyScalar(1.1);
  T.far.uSeaSun.value.copy(row.light).multiplyScalar(Math.max(0.1, f.fade)); T.far.uSeaSunDir.value.copy(f.body);
  if (post) {
    post.vol.setSun(f.body, airTint.copy(row.volColor).multiplyScalar(Math.max(0.15, f.fade)));
    post.vol.setFogColor(f.fog);
    post.vol.setStrength(row.vol);
    if (post.rays) post.rays.blendMode.opacity.value = row.rays * f.above;
    if (post.hueSat) post.hueSat.saturation = row.sat;
  }
}
