import { CueDirector } from '../audio/cueDirector';
/** Client-only roaming boss projection. All author input is rows and ids. */
import * as THREE from 'three';
import * as v from 'valibot';
import { RoamingBossProjectionSchema, type RoamingBossProjectionRows } from '@wildshard/format/roamingBossProjection';
import { pageCombatSession } from '../Boss';
import { rowFightScript } from './barFeed';
import { installEnteredRuntimeService } from '../shard/retainedHooks';
import { prepareBossSocketRig, bindBossSocketRig, bossSocketResources, type BossSocketRig } from './socketRig';
import { keyedSkyOf } from '../looks/keyedSky';
import type { Animal } from '@wildshard/engine/entities/AnimalView';
import type { BossScript } from '@wildshard/engine/ai/BossBrain';
import { LightPool } from '@wildshard/engine/fx/LightPool';
import { fogUniforms } from '@wildshard/engine/world/Atmosphere';
import { terrainHeight as heightAt } from '@wildshard/engine/world/terrainHeight';
import { GroundTell } from '../eliteView';
import { effectField } from '@wildshard/engine/fx/effectField';
import { lentLook, setLentParam } from '../shardfile/lentLooks';
import type { ShardContext } from '../plugin/context';
import { DomePuffs } from '@wildshard/engine/fx/groundFx';
import { wirePage } from '../shardfile/wirePage';
import { ROAMING_HAZARD_EVENTS, ROAMING_VIEW } from '../../../shared/game/shardfile/wirePrompts';

/** The lane states `ROAMING_VIEW.lane` numbers. */
const LANE_STATES = ['none', 'tell', 'run', 'skid'] as const;

interface HazardView { group: THREE.Group; flame: THREE.Object3D; ring: GroundTell; from: THREE.Vector3 }

/** a number some other system rewrites every frame (or never): scaled on top of whatever it holds this frame */
class Dim {
  private base = 0; private last = Number.NaN;
  apply(cur: number, k: number): number { if (cur !== this.last) this.base = cur; const value = this.base * k; this.last = value; return value; }
}

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _col = new THREE.Color(), _fog = [0, 0, 0];


/** A hazard's beat, as the server's fight says it. */
type HazardBeat = (typeof ROAMING_HAZARD_EVENTS)[number];
interface HazardFrame { readonly x: number; readonly y: number; readonly z: number; readonly fallT: number }
interface RingWave { readonly g: GroundTell; r: number }
/** What a Boss and a session keep of this fight: its points, and the room as the server's fight said it. */
export type ProjectionFight = BossScript & { readonly room: HeardRoom };

/** A lane's tell. The server's lane runs; a page paints what it says. */
class LaneTell {
  private readonly decal: GroundTell;
  constructor(scene: THREE.Scene, colour: THREE.ColorRepresentation) { this.decal = new GroundTell(scene, 'lane', colour); }
  dispose(): void { disposeTell(this.decal); }
  /** One frame of the tell. */
  paint(state: string, elapsed: number, duration: number, x0: number, z0: number, x1: number, z1: number, width: number, time: number): void {
    this.decal.setTime(time);
    if (state === 'tell') {
      const k = Math.min(1, elapsed / duration); this.decal.lane(x0, z0, x1, z1, width, .35 + .55 * k * (.75 + .25 * Math.sin(time * 22)));
    } else if (state === 'run') this.decal.lane(x0, z0, x1, z1, width, Math.max(0, .6 - elapsed * 1.2));
    else this.decal.hide();
  }
  hide(): void { this.decal.hide(); }
}
function disposeTell(tell: GroundTell): void {
  tell.mesh.removeFromParent(); tell.mesh.geometry.dispose();
  for (const material of Array.isArray(tell.mesh.material) ? tell.mesh.material : [tell.mesh.material]) material.dispose();
}

/** The room and its light on a server's page, as that server's fight last said them. */
interface HeardRoom { sealK: number; darkK: number; glow: number; open: number; hung: boolean; readonly focus: THREE.Vector3 }
/** A page on a server steps no fight: what the server's fight tells its views paints these, and a lane that stops being said ends. */
interface FollowedFight {
  readonly rows: RoamingBossProjectionRows; readonly ring: (index: number, t: number, at: THREE.Vector3 | null) => void; readonly hazard: (index: number, frame: HazardFrame, t: number, beat: HazardBeat) => void; readonly cues: NonNullable<ReturnType<typeof CueDirector.entered>>;
  readonly lane: LaneTell; readonly addLanes: readonly LaneTell[]; readonly tellRing: GroundTell; readonly puffs: DomePuffs;
  readonly waves: readonly RingWave[]; readonly heardRoom: HeardRoom; readonly hazardFrom: THREE.Vector3;
  readonly room: (dt: number, t: number) => void; readonly sound: (at: THREE.Vector3) => void; readonly light: (on: boolean) => void; readonly rig: () => void;
  readonly struck: (point: THREE.Vector3, dir: THREE.Vector3) => void;
}
const LANE_HEARD_FOR = 0.25;
/** A lane heard since the last frame. */
const FRESH = Number.POSITIVE_INFINITY;
function followRoamingFight(context: ShardContext, { rows, ring, hazard, cues, lane, addLanes, tellRing, puffs, waves, heardRoom, hazardFrom, room, sound, light, rig, struck }: FollowedFight): void {
  const lanes = [lane, ...addLanes], heard = lanes.map(() => Number.NEGATIVE_INFINITY), point = new THREE.Vector3(), up = new THREE.Vector3();
  const actions: Readonly<Record<string, (args: readonly number[]) => void>> = {
    [ROAMING_VIEW.roar]: ([x = 0, y = 0, z = 0]) => { sound(point.set(x, y, z)); },
    [ROAMING_VIEW.burst]: ([x = 0, y = 0, z = 0]) => { cues.cue(rows.events.burst, point.set(x, y, z), up.set(0, 1, 0)); },
    [ROAMING_VIEW.add]: ([arrives = 0, x = 0, y = 0, z = 0]) => {
      if (arrives === 1) puffs.burst(point.set(x, heightAt(x, z) + rows.puffs.lift, z), ...rows.puffs.enter); else puffs.burst(point.set(x, y + rows.puffs.lift, z), ...rows.puffs.leave);
    },
    [ROAMING_VIEW.ring]: ([index = 0, t = 0, shown = 0, x = 0, z = 0, radius = 0]) => {
      const wave = waves[index]; if (wave === undefined) return;
      wave.r = radius; ring(index, t, shown === 1 ? point.set(x, 0, z) : null);
    },
    [ROAMING_VIEW.tell]: ([x = 0, z = 0, radius = 0, alpha = 0, t = 0]) => { tellRing.setTime(t); tellRing.ring(x, z, radius, alpha); },
    [ROAMING_VIEW.tellOff]: () => { tellRing.hide(); },
    [ROAMING_VIEW.lane]: ([slot = 0, state = 0, elapsed = 0, duration = 1, x0 = 0, z0 = 0, x1 = 0, z1 = 0, width = 0, t = 0]) => {
      lanes[slot]?.paint(LANE_STATES[state] ?? 'none', elapsed, duration, x0, z0, x1, z1, width, t); heard[slot] = FRESH;
    },
    [ROAMING_VIEW.room]: ([sealK = 0, darkK = 0]) => { heardRoom.sealK = sealK; heardRoom.darkK = darkK; },
    [ROAMING_VIEW.light]: ([on = 0, x = 0, y = 0, z = 0, glow = 0, open = 0]) => { heardRoom.focus.set(x, y, z); heardRoom.glow = glow; heardRoom.open = open; light(on === 1); },
    [ROAMING_VIEW.rig]: ([glow = 0, open = 0, hung = 0]) => { heardRoom.glow = glow; heardRoom.open = open; heardRoom.hung = hung === 1; rig(); },
    [ROAMING_VIEW.struck]: ([x = 0, y = 0, z = 0, dx = 0, dy = 0, dz = 0]) => { struck(point.set(x, y, z), up.set(dx, dy, dz)); },
    [ROAMING_VIEW.hazard]: ([index = 0, event = 0, t = 0, x = 0, y = 0, z = 0, fallT = 0, fromX = 0, fromY = 0, fromZ = 0]) => {
      const beat = ROAMING_HAZARD_EVENTS[event]; if (beat === undefined) return;
      hazardFrom.set(fromX, fromY, fromZ); hazard(index, { x, y, z, fallT }, t, beat);
    },
  };
  wirePage.whenLive(context.scope, client => client.onView(({ name, args }) => { actions[name]?.(args); }));
  context.system({ id: 'roaming.followed', phase: 'update', run: (dt, t) => {
    room(dt, t);
    for (const [slot, row] of lanes.entries()) {
      if (heard[slot] === FRESH) heard[slot] = t; // the clock's the frame's: a slow frame still shows what it heard
      else if (t - (heard[slot] ?? 0) > LANE_HEARD_FOR) row.hide();
    }
  } });
}
export async function installRoamingBossProjection(context: ShardContext, input: unknown): Promise<ProjectionFight> {
  const rows = v.parse(RoamingBossProjectionSchema, input);
  await prepareBossSocketRig(context, rows.socketRig);
  return context.scope.run(() => enterProjection(context, rows));
}
function enterProjection(context: ShardContext, rows: RoamingBossProjectionRows): ProjectionFight {
  const session = pageCombatSession(context.scope, rows.session), ctx = session.context;
  const scene = ctx.game.scene, kit = bossSocketResources(context.scope, rows.socketRig.id), encounterRows = rows.encounter;
  const tellRing = new GroundTell(scene, 'ring', new THREE.Color(...rows.colours.tell));
  const waves: RingWave[] = [0, 1].map(() => ({ g: new GroundTell(scene, 'ring', new THREE.Color(...rows.colours.wave)), r: 0 }));
  const lane = new LaneTell(scene, new THREE.Color(...rows.colours.tell));
  const addLanes = Array.from({ length: encounterRows.lanes.count }, () => new LaneTell(scene, new THREE.Color(...rows.colours.wave)));
  const C = encounterRows.profile.fight.origin, R = rows.wall.radius;
  const cues = CueDirector.entered(context,rows.presentation);
  if (cues === undefined) throw new Error('Missing declared roaming presentation');
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(R, R * rows.wall.bottom, rows.wall.height, rows.wall.segments, 1, true).translate(0, rows.wall.height / 2, 0), lentLook(rows.wall.look));
  wall.position.set(C.x, heightAt(C.x, C.z) + rows.wall.lift, C.z); wall.visible = false; wall.frustumCulled = false; wall.renderOrder = rows.wall.order;
  wall.name = rows.wall.name; scene.add(wall);
  const puffs = new DomePuffs(scene, new THREE.Color(...rows.colours.puff), rows.puffs.count);
  const fallen: HazardView[] = rows.socketRig.hazards.map(() => {
    const group = new THREE.Group(); group.visible = false;
    const fire = effectField({ name: rows.hazard.name, shape: 'streak', count: 1 }, lentLook(rows.hazard.look)), flame = fire.object;
    context.scope.own(fire.geometry); context.scope.onDispose(() => { group.removeFromParent(); flame.removeFromParent(); });
    fire.place(_v.set(0, 0, 0), _w.set(0, 1, 0)); flame.scale.fromArray(rows.hazard.flameScale); flame.visible = false; flame.renderOrder = rows.hazard.order; scene.add(group, flame);
    const detached = new THREE.Group();
    for (const row of rows.hazard.meshes) { const mesh = new THREE.Mesh(kit.geometry(row.geometry), kit.standard(row.material)); mesh.castShadow = false; detached.add(mesh); }
    detached.scale.setScalar(rows.hazard.scale); group.add(detached);
    return { group, flame, ring: new GroundTell(scene, 'ring', new THREE.Color(...rows.colours.wave)), from: new THREE.Vector3() };
  });
  const pool = LightPool.for(scene);
  let light: THREE.PointLight | null = pool.acquire(rows.light.colour, 0, rows.light.distance, rows.light.decay);
  let look: BossSocketRig | null = null, rowBody: Animal | null = null;
  /** A page's own room comes off its fight. */
  const heardRoom: HeardRoom = { sealK: 0, darkK: 0, glow: 0, open: 0, hung: true, focus: new THREE.Vector3() }, ember = { darkK: (): number => heardRoom.darkK }, hazardFrom = new THREE.Vector3();
  /** A page on a server has no body of its own: the rig goes on the row's, as the fight says it, and comes off when the row goes. */
  const rigView = (): void => {
    if (rowBody !== null && !ctx.animals.animals.includes(rowBody)) { look?.dispose(); look = null; rowBody = null; }
    rowBody ??= ctx.animals.animals.find(body => body.rowDriven && body.kind === encounterRows.kind) ?? null;
    if (rowBody === null) return;
    look ??= bindBossSocketRig(context.scope, rows.socketRig.id, rowBody);
    look.setHazardsHung(heardRoom.hung);
  };
  const struckView = (point: THREE.Vector3, dir: THREE.Vector3): void => {
    cues.cue(rows.events.hit, point, dir); wirePage.drew('struck');
    if (look !== null && point.distanceTo(look.focusWorld(_v)) < look.focusRadius) cues.cue(heardRoom.open > 0.5 ? rows.events.open : rows.events.shut, point, dir);
  };
  const lightView = (on: boolean): void => {
    if (on) light ??= pool.borrow(rows.light.colour, 0, rows.light.distance, rows.light.decay);
    else if (light) { pool.release(light); light = null; }
  };
  const hazardView: FollowedFight['hazard'] = (i, f, t, event) => {
    const view = fallen[i]; if (view === undefined) return;
    if (event === 'drop') { if (look === null) view.from.copy(hazardFrom); else look.hazardWorld(i, view.from); view.group.visible = true; view.group.position.copy(view.from); }
    else if (event === 'fall' || event === 'land') {
      const u = f.fallT, from = view.from;
      view.group.position.set(from.x + (f.x - from.x) * u, from.y + (f.y + rows.hazard.landingLift - from.y) * u * u + Math.sin(u * Math.PI) * rows.hazard.arc, from.z + (f.z - from.z) * u);
      view.group.rotation.set(u * rows.hazard.rotation[0], u * rows.hazard.rotation[1], u * rows.hazard.rotation[2]);
      if (event === 'land') { ctx.shot(rows.landSound, _v.set(f.x, f.y, f.z)); cues.cue(rows.events.land, _v, _w.set(0, 1, 0)); }
    } else if (event === 'burn') {
      const dark = ember.darkK(), glow = dark > 0 ? 1 - rows.hazard.dark * dark : 1;
      view.flame.visible = true; view.flame.position.set(f.x, f.y, f.z);
      setLentParam(rows.hazard.look, rows.hazard.alpha, rows.hazard.alphaBase * glow);
      view.ring.setTime(t);
      view.ring.ring(f.x, f.z, rows.hazard.radius, (rows.hazard.pulse[0] + rows.hazard.pulse[1] * Math.sin(t * rows.hazard.pulse[2] + f.x)) * glow, rows.hazard.width);
    } else if (event === 'placed') { view.group.visible = true; view.group.position.set(f.x, f.y + rows.hazard.landingLift, f.z); view.group.rotation.set(rows.hazard.rotation[0], i, rows.hazard.rotation[2]); }
    else { view.group.visible = false; view.flame.visible = false; view.ring.hide(); }
  };
  const ringView: FollowedFight['ring'] = (i, t, at) => {
    const w = waves[i]; if (w === undefined) return;
    if (at === null) w.g.hide(); else { w.g.setTime(t); w.g.ring(at.x, at.z, w.r, 0.95, 0.25); }
  };
  const air = heardRoom;


  /** the fog wall, the puffs, the ribcage's opening and the fight's light, every frame (I–II: the ribcage's amber on the
   *  stones; III: your lantern) */
  // PF5: the wall's look params are written when they change (outside a fight, never: every frame wrote the same values)
  let wallSeal = Number.NaN; const wallFog = new THREE.Color(-1, -1, -1);
  function room(dt: number, t: number): void {
    const seal = rows.wall.seal * air.sealK, fog = scene.fog;
    if (seal !== wallSeal) { wallSeal = seal; setLentParam(rows.wall.look, rows.wall.alpha, seal); }
    wall.visible = seal > rows.wall.visible;
    if (fog instanceof THREE.Fog && !fog.color.equals(wallFog)) {
      wallFog.copy(fog.color); setLentParam(rows.wall.look, rows.wall.colour, _col.copy(fog.color).multiplyScalar(rows.wall.colourGain).toArray(_fog));
    }
    puffs.update(dt, t);
    if (look !== null) { look.setGlow(heardRoom.glow); look.setOpen(Math.max(heardRoom.open, 0.35 * heardRoom.darkK), t); } // in this order, as a frame of his own fight lands them: the opening burns over the glow
    if (!light) return;
    if (air.darkK > rows.light.darkness) {
      const c = ctx.game.camera.position;
      light.position.set(c.x, c.y + rows.light.playerAbove, c.z); light.color.fromArray(rows.light.playerColour); light.distance = rows.light.playerDistance; light.intensity = rows.light.playerGain * air.darkK;
    } else {
      if (look === null) light.position.copy(heardRoom.focus); else look.focusWorld(light.position);
      light.position.y += rows.light.focusAbove; light.color.fromArray(rows.light.focusColour); light.distance = rows.light.focusDistance;
      light.intensity = rows.light.focusGain * air.glow * (rows.light.focusOpen[0] + rows.light.focusOpen[1] * air.open);
    }
  }

  const dimFog = new Dim(), dimHemi = new Dim(), dimEnv = new Dim(), dimLights: Dim[] = [], dimDome = [new Dim(), new Dim()];
  const fogCol = new THREE.Color(), fogLast = new THREE.Color(-1, -1, -1);
  /** the fog closing (the seal) and the Last Light's dark, scaled on top of what the sky set this frame */
  const atmosphere = (): void => {
    const { sealK: seal, darkK: dark } = air;
    if (seal <= 0 && dark <= 0 && fogLast.r < 0) return;
    const sky = ctx.sky;
    fogUniforms.fogDistDensity.value = dimFog.apply(fogUniforms.fogDistDensity.value, 1 + rows.room.density[0] * seal + rows.room.density[1] * dark);
    const fog = scene.fog;
    if (fog instanceof THREE.Fog) {
      if (!fog.color.equals(fogLast)) fogCol.copy(fog.color);
      fog.color.copy(_col.copy(fogCol).multiplyScalar(1 - rows.room.fog[0] * seal - rows.room.fog[1] * dark));
      fogLast.copy(fog.color);
      if (seal <= 0 && dark <= 0) { fog.color.copy(fogCol); fogLast.setRGB(-1, -1, -1); }
    }
    sky.hemi.intensity = dimHemi.apply(sky.hemi.intensity, 1 - rows.room.hemi * dark);
    scene.environmentIntensity = dimEnv.apply(scene.environmentIntensity, 1 - rows.room.environment * dark);
    const dome = keyedSkyOf(sky)?.dome.material;
    if (dome instanceof THREE.ShaderMaterial) {
      const ga = dome.uniforms[rows.room.domeUniforms[0]], gb = dome.uniforms[rows.room.domeUniforms[1]], dk = 1 - rows.room.dome * dark;
      if (ga && typeof ga.value === 'number') ga.value = dimDome[0]?.apply(ga.value, dk) ?? ga.value;
      if (gb && typeof gb.value === 'number') gb.value = dimDome[1]?.apply(gb.value, dk) ?? gb.value;
    }
    sky.csm.lights.forEach((l, i) => {
      let dim = dimLights[i];
      if (dim === undefined) { dim = new Dim(); dimLights[i] = dim; }
      l.intensity = dim.apply(l.intensity, 1 - rows.room.lights * dark);
    });
  };

  followRoamingFight(context, { rows, ring: ringView, hazard: hazardView, cues, lane, addLanes, tellRing, puffs, waves, heardRoom, hazardFrom, room, sound: at => { ctx.animals.onSound?.(rows.roar, at); }, light: lightView, rig: rigView, struck: struckView });
  installEnteredRuntimeService(context, scope => {
    const descriptor = Object.getOwnPropertyDescriptor(scene, 'onBeforeRender'), previous = scene.onBeforeRender.bind(scene);
    scene.onBeforeRender = (...args) => { atmosphere(); previous(...args); };
    scope.onDispose(() => { if (descriptor === undefined) Reflect.deleteProperty(scene, 'onBeforeRender'); else Object.defineProperty(scene, 'onBeforeRender', descriptor); });
  });
  if (light !== null) { pool.release(light); light = null; } // held, no fight lights it, and the next light asked for makes the level one more, which rebuilds every lit program (DL10: Pine 61 / 107)
  context.scope.onDispose(() => {
    disposeTell(tellRing); for (const wave of waves) disposeTell(wave.g); for (const hazard of fallen) disposeTell(hazard.ring);
    lane.dispose(); for (const add of addLanes) add.dispose(); puffs.dispose();
    if (light !== null) { pool.release(light); light = null; } look?.dispose(); wall.removeFromParent(); wall.geometry.dispose(); });
  const { points } = encounterRows.profile.fight, rewardZ = C.z + points.rewardZ, respawnZ = C.z + points.respawnZ;
  return rowFightScript({ room: heardRoom, rewardPoint: () => new THREE.Vector3(C.x, heightAt(C.x, rewardZ) + points.rewardY, rewardZ),
    respawnPoint: () => ({ pos: new THREE.Vector3(C.x, heightAt(C.x, respawnZ), respawnZ), yaw: points.respawnYaw }) });
}
