/** Client-only encounter views (the boss fight host, G474): a slot encounter's cues and telegraph on the cue director
 * and ground tells, a patrol's looks, figures, arrows and cues, and a boss's cloud body. The law stays in
 * existing AS projections and the fight; no shard renderer callback is accepted. Never imported by renderer-free hosts. */
import * as THREE from 'three';
import * as v from 'valibot';
import { TIER } from '@wildshard/engine/core/tier';
import { app } from '@wildshard/engine/app/runtime';
import type { Scope } from '@wildshard/engine/app/scope';
import { pinBrain } from '@wildshard/engine/ai/pinning';
import type { TargetAnimal, TargetHit } from '@wildshard/engine/combat/types';
import { Projectiles, type ProjectileWorld } from '@wildshard/engine/combat/view/projectile';
import type { Animal } from '@wildshard/engine/entities/AnimalView';
import { FX, fxMaterial, type FxMaterial } from '@wildshard/engine/fx/groundFx';
import { terrainHeight as heightAt } from '@wildshard/engine/world/terrainHeight';
import type { ModelContext, ModelDef } from '@wildshard/engine/models/model';
import { place, type Placed } from '@wildshard/engine/models/place';
import { modelPoseMatrix } from '@wildshard/engine/models/modelPose';
import { boxDesc, type WorldRegistry } from '@wildshard/engine/world/registry';
import type { SkyRig } from '@wildshard/engine/world/skyRig';
import { replaceSpecimenInstances } from '../models/specimenCatalogue';
import type { CueDirector } from '../audio/cueDirector';
import { GroundTell } from '../eliteView';
import { LightningStrip } from '../weapons/arcPower';
import { nearestJointHit, type JointPorts } from '../../../shared/game/boss/jointTargets';
import { ProjectedState, type ReturnProgram } from '../../../shared/game/population/returnProgram';
import { PatrolLaw, type PatrolRider } from '../../../shared/game/boss/patrolLaw';
import { SlotEncounterLaw } from '../../../shared/game/boss/slotLaw';
import { createClientScene } from '../plugin/scene';
import { installChannelPrograms } from '../../../shared/game/plugin/channelPrograms';
import { lentLook, lentLookInstance, setLentParam, type LookInstance } from '../shardfile/lentLooks';
import { CloudSpecimenSchema, EncounterSitesSchema, type EncounterSlotsRows, type EncounterPatrolRows, type EncounterScheduleRows, type SlotViewRows, type PatrolViewRows, type CloudBodyRows, type ArenaSceneRows, type EncounterMaterialRows } from '@wildshard/format/encounterRows';

/**
 * What a slot encounter shows (the cycle's `wake` / `dawn` flags spawn into and release the sites): `cues` at a site as an
 * actor wakes, on a hit (`weak` where the guest finds a weak point, `hard` past `drop` hp), on the member's `broken` flag
 * and as the actor's `strike` memory field turns 1 (then 2), `ahead` × the tell's reach in front; `trails` every `every` s
 * while a memory field is in [min, max), with `chance`; `lift` raises each point (the body's × the actor's scale). The
 * `tell` wedge (a copy of its lent graph look per pooled wedge: params `fill` and `alpha`) fills through the attack's `wind` and shows until
 * `strike` + `hold`, alpha `alpha[0] + alpha[1] × fill`, then `alpha[2]` on the blow.
 */
/** a `{ value }` port onto one look copy's float param (the ground tell writes its fill and alpha through it) */
function lookParam(look: LookInstance, name: string): { value: number } {
  let held = 0;
  return { get value(): number { return held; }, set value(to: number) { if (to !== held) { held = to; look.setParam(name, to); } } };
}
/** A slot actor as drawn: where it stands and faces, its health and its attack's phase (−1 between attacks). */
export interface SlotViewActor extends PatrolActor { readonly scale:number; yOffset:number; readonly position: { readonly x: number; readonly y: number; readonly z: number }; readonly yaw: number; readonly hp: number; readonly attackPhase: number }
const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
/** A placed site: where it stands and the copy that draws it. */
export interface EncounterSite { readonly x:number; readonly z:number; readonly yaw:number; readonly variant:number; readonly y: number; readonly scale: number; readonly tilt: number; readonly slot: number;
  readonly collider: { x: number; z: number; hw: number; hd: number; rot: number; yTop: number; yBottom: number; ghost: true } }
/** A slot encounter's sites on the ground: drawn instanced, solid while they stand, hidden while their actor is out. */
export class EncounterSites {
  readonly sites: EncounterSite[] = [];
  readonly object: THREE.Group = new THREE.Group();
  private readonly rows: v.InferOutput<typeof EncounterSitesSchema>;
  private readonly awake: boolean[] = [];
  private meshes: THREE.InstancedMesh[] = [];
  constructor(input: unknown) {
    const rows = this.rows = v.parse(EncounterSitesSchema, input), counts = rows.variants.map(() => 0), c = rows.collider;
    this.object.name = rows.name;
    for (const [i, s] of rows.sites.entries()) {
      const variant = rows.variantCycle[i % rows.variantCycle.length] ?? 0;
      if (rows.variants[variant] === undefined) throw new Error(`Encounter site has no variant ${String(variant)}`);
      const slot = counts[variant] ?? 0, y = heightAt(s.x, s.z) - rows.sink * s.scale; counts[variant] = slot + 1;
      this.sites.push({ x: s.x, y, z: s.z, yaw: s.yaw, scale: s.scale, tilt: s.tilt, variant, slot,
        collider: { x: s.x, z: s.z, hw: c.hw * s.scale, hd: c.hd * s.scale, rot: -s.yaw, yBottom: y - c.bottom, yTop: y + c.top * s.scale, ghost: true } });
    }
  }
  /** The sites' colliders as data (each is also its own registry piece once registered). */
  get colliders(): readonly EncounterSite['collider'][] { return this.sites.map(site => site.collider); }
  /** Place the model instanced at every site, wearing the generated asset when it lands. */
  place<P extends object>(model: ModelDef<P>, ctx: ModelContext, registry: WorldRegistry, sky: SkyRig,files?:ReadonlyMap<string,Uint8Array>): Placed {
    const placed = place(model, this.sites.map(s => ({ x: s.x, y: s.y, z: s.z, matrix: modelPoseMatrix({ x: s.x, y: s.y, z: s.z, yaw: s.yaw, scale: s.scale, roll: s.tilt }),
      variant: this.rows.variants[s.variant] ?? '' })), { ctx, draw: 'instanced', registry });
    this.object.add(placed.object);
    this.meshes = this.rows.variants.map(variant => {
      const key = `${model.id}:${variant}:0`, found: unknown = placed.object.name === key ? placed.object : placed.object.getObjectByName(key);
      return isInstances(found) ? found : new THREE.InstancedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial(), 0);
    });
    replaceSpecimenInstances(sky, this.rows.generated, this.meshes,files);
    return placed;
  }
  /** Each site its own piece, following the sites' group, solid only while it stands. */
  register(registry: WorldRegistry): void {
    this.object.updateWorldMatrix(true, false);
    this.sites.forEach((s, i) => {
      registry.add({ id: `${this.rows.name}-${String(i)}`, name: this.rows.label, category: 'props', file: this.rows.file, surface: this.rows.surface,
        follows: this.object, colliders: [boxDesc(s.collider)], active: () => this.awake[i] !== true });
    });
  }
  /** Apply a slot view's site changes. */
  apply(changes: readonly SlotSiteChange[]): void { for (const change of changes) this.setAwake(change.index, change.awake === 1); }
  isAwake(index: number): boolean { return this.awake[index] === true; }
  private setAwake(index: number, awake: boolean): void {
    const s = this.sites[index], mesh = this.meshes[s?.variant ?? -1];
    if (s === undefined || mesh === undefined || this.awake[index] === awake) return;
    this.awake[index] = awake;
    mesh.setMatrixAt(s.slot, awake ? hidden : modelPoseMatrix({ x: s.x, y: s.y, z: s.z, yaw: s.yaw, scale: s.scale, roll: s.tilt }));
    mesh.instanceMatrix.needsUpdate = true;
  }
}
/** A site whose actor woke (`awake` 1: hide it) or is home again (0: stand it back up), for the caller's own sites. */
export interface SlotSiteChange { readonly index: number; readonly awake: number }
const UP = new THREE.Vector3(0, 1, 0);

/** Presentation over the same renderer-free slot owner used by native tapes. */
export class SlotEncounterView<A extends SlotViewActor = Animal> extends SlotEncounterLaw<A,GroundTell> {
  /** The tell wedges: a row page draws them from each body's row. */
  readonly tells:readonly GroundTell[];
  constructor(slots:EncounterSlotsRows,view:SlotViewRows,program:ReturnProgram,ports:{readonly scene:THREE.Scene;readonly cues:CueDirector;
    readonly sites:readonly Pick<EncounterSite,'x'|'z'|'yaw'|'variant'>[]|null;readonly guest:ReturnProgram}) {
    // Keep original metadata refusal before allocating the tell look copies.
    ProjectedState.preflight({...slots.cycle,signals:{step:slots.cycle.signal}});
    const tell=view.tell,wedges:GroundTell[]=[];
    for(let i=0;i<tell.pool;i++){
      const look=lentLookInstance(tell.look);
      wedges.push(new GroundTell(ports.scene,'wedge',0,{cone:tell.cone,material:look.material,fill:lookParam(look,'fill'),alpha:lookParam(look,'alpha')}));
    }
    super(slots,view,program,{sites:ports.sites,cues:ports.cues,guest:ports.guest,wedges,ground:heightAt,cosmetic:()=>app.rng.stream('cosmetic').next()});
    this.tells=wedges;
  }
}

/**
 * What a patrol shows: each actor's `looks` (keyed by variant, or `quiet` for a quiet spawn, which also grows by
 * `quietScale`): a copy of its lent graph look on the body and on its figure (param `fade`, the member's `fade` state) and
 * on a figure mesh the caller supplies per look, hung on the rig's `bone`; the cues where it forms (`lift` over the ground),
 * where it tears apart while `dying`, behind its gallop (`trail`: `rate` a second, `back` m behind the `seat`), as it looses
 * (`aim` signal, from `lift` over the seat) and where its arrows hit you or the world; and `targets`, spheres in the bone's
 * frame (radius × scale) that a ray may hit before the body's own capsules.
 */
/** Native bodies and allocation authority; neither supplies authored rules. */
interface PatrolActor { readonly entityId:string; readonly position:{readonly x:number;readonly z:number}; readonly mem:Record<string,number>; readonly alive:boolean; readonly hidden:boolean; herd:number }
interface PatrolActorRoster<A extends PatrolActor> { readonly factory:{model:(kind:string,variant:string)=>unknown}; spawn:(kind:string,x:number,z:number,yaw:number,variant:string)=>A; retire:(actor:A)=>void }
/** A patrol actor as drawn: its skinned body, scale, variant and facing; a target the player's shots can strike. */
export interface PatrolViewActor extends TargetAnimal { readonly entityId: string; readonly mem: Record<string, number>; readonly hidden: boolean; herd: number;
  readonly mesh: THREE.SkinnedMesh; scale: number; readonly variant: string; readonly yaw: number }
/** An arrow that struck the player this step: its damage and who loosed it. */
export interface PatrolHit<A> { readonly damage: number; readonly from: A | null }
/** A rider's drawn state beside its law (patrolLaw.ts): its scope, its looks' fades and the bone its figure rides. */
interface RiderView { readonly scope: Scope; readonly fades: { value: number }[]; readonly bone: THREE.Object3D }
type Rider<A extends PatrolViewActor> = PatrolRider<A, RiderView>;
const seat = new THREE.Vector3(), back = new THREE.Vector3(), aimed = new THREE.Vector3(), ray = new THREE.Ray();

/** One native patrol roster drawn; its numbers (cycle, lines, riders' laws, steering, aim) are PatrolLaw's. */
export class PatrolEncounterView<A extends PatrolViewActor = Animal> {
  /** the patrol's law: the same one a Node simulation runs (CI12's Qara Batyr tape) */
  readonly law: PatrolLaw<A, RiderView>;
  get riders(): readonly Rider<A>[] { return this.law.riders; }
  readonly arrows: Projectiles;
  private readonly rows: PatrolViewRows;
  private readonly hits: PatrolHit<A>[] = [];
  private readonly hit: TargetHit;
  // the drawn riders' joint spheres (jointTargets.ts): a rider's figure bone carries them
  private readonly joints: JointPorts<Rider<A>, A> = { actor: r => r.a, dead: r => r.law.state[this.rows.states.dead] === 1,
    joint: (r, at, out) => out.set(...at).applyMatrix4(r.view.bone.matrixWorld) };
  private shooter: A | null = null;
  private readonly dressed = new WeakMap<A, RiderView>();
  get killsTonight(): number { return this.law.killsTonight; }
  constructor(input: { readonly patrol: EncounterPatrolRows; readonly motion: EncounterScheduleRows; readonly view: PatrolViewRows }, program: ReturnProgram,
    private readonly ports: ProjectileWorld & { readonly cues: CueDirector; readonly figures: Readonly<Record<string, THREE.BufferGeometry>> }) {
    this.rows = input.view;
    this.law = new PatrolLaw<A, RiderView>(input.patrol, input.motion, program, { player: ports.player, random: app.rng.stream('ai'), aimRandom: () => app.rng.stream('ai'),
      present: (a, quiet) => this.present(a, quiet) });
    for (const key of Object.keys(this.rows.looks)) if (ports.figures[key] === undefined) throw new Error(`Missing patrol figure: ${key}`);
    const { geometry, colour, renderOrder, ...kind } = this.rows.arrow;
    this.arrows = new Projectiles(ports, undefined, { ...kind, geometry: new THREE.BufferGeometryLoader().parse(geometry),
      material: new THREE.MeshBasicMaterial({ color: new THREE.Color(...colour), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide, toneMapped: false, fog: false }) });
    this.arrows.mesh.renderOrder = renderOrder; this.arrows.mesh.receiveShadow = false; this.arrows.mesh.name = 'patrol-arrows';
    this.arrows.onPlayerHit = at => { this.hits.push({ damage: this.rows.damage, from: this.shooter }); ports.cues.cue(this.rows.cues.hurt, at, UP); };
    this.arrows.onImpact = (_surface, at) => { ports.cues.cue(this.rows.cues.impact, at, UP); };
    this.hit = { animal: { kind: '', position: new THREE.Vector3(), alive: false, applyDamage: () => false, damageFor: () => 0 }, point: new THREE.Vector3(), distance: 0, headshot: false };
  }
  attachActors(roster: PatrolActorRoster<A>): void { this.law.attachActors(roster); }
  /** One actor at (x, z) facing `yaw`, outside any line (drive its steering memory); `quiet` takes the quiet look. */
  spawnRider(at: { readonly x: number; readonly z: number; readonly yaw: number; readonly variant?: string; readonly quiet?: boolean }): A | null { return this.law.spawnRider(at); }
  /** A line of `count` from `at` (m along the route; default the farthest from the player), `captain` at its head. */
  spawnLine(at: { readonly count?: number; readonly captain?: boolean; readonly at?: number } = {}): A[] { return this.law.spawnLine(at); }
  dissolve(actor: A): void { this.law.dissolve(actor); }
  dawn(): void { this.law.dawn(); }
  /** On the wire a server rides the night, and a page dresses each row's body once: a rider grown past its kind is a quiet
   *  one. Its gallop's trail is only a look, so it stays this page's, on a body still up. */
  showRows(kind: string, bodies: readonly (A & { readonly rowDriven?: boolean })[], dt: number, cues: Pick<CueDirector, 'cue'>): void {
    for (const a of bodies) {
      if (a.kind !== kind || a.rowDriven !== true) continue;
      let view = this.dressed.get(a);
      if (view === undefined) {
        view = this.dress(a, a.scale >= this.rows.quietScale - 0.01); this.dressed.set(a, view);
        for (const fade of view.fades) fade.value = 1;
      }
      if (a.alive && !a.hidden) this.trail(a, view.bone, dt, cues);
    }
  }
  private present(a: A, quiet: boolean): RiderView {
    const rows = this.rows;
    if (quiet) { a.scale *= rows.quietScale; a.mesh.scale.setScalar(a.scale); }
    const view = this.dress(a, quiet);
    if (quiet) pinBrain(a, view.scope);
    return view;
  }
  private dress(a: A, quiet: boolean): RiderView {
    const rows = this.rows, key = quiet ? rows.quietLook : rows.looks[a.variant] === undefined ? Object.keys(rows.looks)[0] ?? '' : a.variant;
    const look = rows.looks[key], figure = this.ports.figures[key], bone = a.mesh.skeleton.getBoneByName(rows.figure.bone);
    if (look === undefined || figure === undefined || bone === undefined) throw new Error(`Patrol look ${key} needs its look, figure and bone`);
    const scope = this.ports.game.levelScope.child('patrol-actor'), fades: { value: number }[] = [];
    const material = (): THREE.Material => {
      const copy = lentLookInstance(look);
      fades.push(lookParam(copy, 'fade'));
      copy.material.name = look; return copy.material;
    };
    a.mesh.material = material();
    // a ghost casts no shadow: the roster sets castShadow every frame, so it stays pinned off
    Object.defineProperty(a.mesh, 'castShadow', { get: () => false, set: () => { /* pinned */ }, configurable: true });
    const mesh = new THREE.Mesh(figure, material()); mesh.name = `${look}-figure`; mesh.frustumCulled = false; bone.add(mesh);
    this.ports.cues.cue(rows.cues.form, seat.set(a.position.x, heightAt(a.position.x, a.position.z) + rows.lift.form, a.position.z), UP);
    return { scope, fades, bone };
  }
  /** The nearest of the drawn targets along the ray, if nearer than `hit` (the body's own capsules). */
  target(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, hit: TargetHit | null): TargetHit | null {
    ray.set(origin, dir);
    const found = nearestJointHit(ray, hit === null ? maxDist : Math.min(maxDist, hit.distance), this.riders, this.joints, this.rows.targets, this.hit.point);
    if (found === null) return hit;
    this.hit.animal = found.actor; this.hit.distance = found.distance; this.hit.headshot = found.head;
    return this.hit;
  }
  /** Step the patrol and draw it (`frame`: its own fields beside the player's px / py / pz); the arrows that struck the
   *  player since the last call. `freeze` holds every actor where it stands. */
  update(dt: number, _t: number, frame: Readonly<Record<string, number>>, freeze = false): readonly PatrolHit<A>[] {
    this.hits.length = 0;
    const rows = this.rows, cues = this.ports.cues, riders = this.law.riders;
    const effects = this.law.step(dt, frame, freeze);
    for (let i = riders.length - 1; i >= 0; i--) {
      const r = riders[i]; if (r === undefined) continue;
      const a = r.a, effect = effects.get(r), state = r.law.state;
      if (effect?.['retire'] === 1) { this.law.retire(i); r.view.scope.dispose(); continue; }
      for (const fade of r.view.fades) fade.value = state[rows.states.fade] ?? 0;
      if ((state[rows.states.dying] ?? 0) > 0) cues.cue(rows.cues.tear, this.seat(r.view.bone), UP);
      if (state[rows.states.dead] === 1 || a.hidden) continue;
      this.trail(a, r.view.bone, dt, cues);
      if (!freeze && effect?.['shoot'] === 1) this.shoot(r);
    }
    this.arrows.update(dt);
    return this.hits;
  }
  private seat(bone: THREE.Object3D): THREE.Vector3 { return seat.set(...this.rows.seat).applyMatrix4(bone.matrixWorld); }
  /** The gallop's cue behind a rider, `rate` a second. */
  private trail(a: A, bone: THREE.Object3D, dt: number, cues: Pick<CueDirector, 'cue'>): void {
    if (app.rng.stream('cosmetic').next() >= dt * this.rows.trail.rate) return;
    back.set(-Math.sin(a.yaw), 0, -Math.cos(a.yaw));
    cues.cue(this.rows.trail.cue, this.seat(bone).addScaledVector(back, this.rows.trail.back), back);
  }
  /** On the wire a server looses and lands the arrows: this draws the one it heard. Its only hits are a cue's. */
  hearShot([x = 0, y = 0, z = 0, vx = 0, vy = 0, vz = 0]: readonly number[]): void {
    this.arrows.launch(seat.set(x, y, z), aimed.set(vx, vy, vz), { damageScale: 1 });
    this.ports.cues.cue(this.rows.cues.loose, seat, UP);
  }
  /** On the wire a server knows who's dying: this tears the one it heard, where it said. */
  hearTear([x = 0, y = 0, z = 0]: readonly number[], cues: Pick<CueDirector, 'cue'>): void { cues.cue(this.rows.cues.tear, seat.set(x, y, z), UP); }
  /** One frame of the arrows a server loosed. */
  flyRows(dt: number): void { this.hits.length = 0; this.arrows.update(dt); }
  /** One arrow at the player: the `aim` signal's lead and spread from the rider's shoulders. */
  private shoot(r: Rider<A>): void {
    const from = this.seat(r.view.bone); from.y += this.rows.lift.loose * r.a.scale;
    const aim = this.law.aim(this.rows.aim, from);
    this.shooter = r.a;
    this.arrows.launch(from, aimed.set(aim['dx'] ?? 0, aim['dy'] ?? 0, aim['dz'] ?? 0), { damageScale: 1 });
    this.ports.cues.cue(this.rows.cues.loose, from, UP);
  }
}

/** An encounter material: a self-lit `basic` colour (additive, or faded to `opacity`), an FX program (`mode`, its
 *  `alpha`, additive unless `additive` is false), a lit `lambert` colour (sRGB hex), or a ground `decal` (sRGB hex) cut
 *  by its `size` × `size` RGBA `alpha` bytes at `opacity`, pulled `offset` toward the camera. */
/** Build declared materials (the caller's scope owns their lifetime). */
function encounterMaterials(rows: Readonly<Record<string, EncounterMaterialRows>>): Map<string, THREE.Material> {
  const made = new Map<string, THREE.Material>();
  for (const [key, row] of Object.entries(rows)) {
    if (row.kind === 'fx') made.set(key, fxMaterial(FX[row.mode], new THREE.Color(...row.colour), row.alpha, row.additive ?? true));
    else if (row.kind === 'lambert') made.set(key, new THREE.MeshLambertMaterial({ color: row.colour }));
    else if (row.kind === 'decal') {
      if (row.alpha.length !== row.size * row.size * 4) throw new Error(`Decal ${key} needs size × size RGBA bytes`);
      const alphaMap = new THREE.DataTexture(Uint8Array.from(row.alpha), row.size, row.size); alphaMap.needsUpdate = true;
      made.set(key, new THREE.MeshBasicMaterial({ color: row.colour, alphaMap, transparent: true, opacity: row.opacity, depthWrite: false, fog: false,
        polygonOffset: true, polygonOffsetFactor: row.offset, polygonOffsetUnits: row.offset }));
    } else made.set(key, new THREE.MeshBasicMaterial({ color: new THREE.Color(...row.colour), toneMapped: false, fog: false, ...(row.additive ? { blending: THREE.AdditiveBlending, depthWrite: false } : {}),
      ...(row.opacity === undefined ? {} : { transparent: true, opacity: row.opacity }) }));
  }
  return made;
}
/**
 * A cloud body: `scene` and its `geometry` (`materials` by port id: a self-lit basic colour or an FX program), posed by
 * the `group` of `poses` channel rows reading the caller's `pose` fields (and its extra ports), scaled by `scale` at
 * `root`. Its `puffs` (`rows` on `bones`, an icosphere of `detail`) churn (`swell` [share, rate], `drift` [x rate, y rate,
 * m], `spin` rad/s, `squash` y) in the lent `look`, which reads `params` (time, focus point, glow, flash, alpha, fog colour
 * and fog). Its `focus` part blazes from `colour[0]` to `colour[1]` as the `open` pose field rises, its `glow` part's alpha
 * and the look's glow ride `glowAlpha` and `lookGlow` [base, gain], and its `ring` faces the camera, spinning at `spin`
 * and pulsing `pulse` [base, gain, rate] while open; `shown` parts show and hide with the body.
 */
interface Puff { readonly bone: THREE.Object3D; readonly p: THREE.Vector3; readonly r: number; readonly ph: number }
const at = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), turn = new THREE.Quaternion(), size = new THREE.Vector3(), matrix = new THREE.Matrix4();

/** A cloud body built from its rows; `update(t, camera)` poses and draws it. */
export class CloudBody {
  /** what the look reads: the fight raises `flash`, fades `alpha` and keeps the fog's colour and density */
  readonly alpha = { value: 1 }; readonly flash = { value: 0 }; readonly glow = { value: 0.4 };
  readonly fogColour: THREE.Color = new THREE.Color(0.3, 0.32, 0.4); readonly fog = { value: 0.1 };
  readonly focusPoint: THREE.Vector3 = new THREE.Vector3();
  visible = false;
  private readonly rows: CloudBodyRows;
  private readonly parts: ReadonlyMap<string, THREE.Object3D>;
  readonly puffs: THREE.InstancedMesh;
  private readonly list: Puff[];
  private readonly draw: ReturnType<typeof installChannelPrograms>;
  private readonly made: Map<string, THREE.Material>;
  private readonly focusMaterial: THREE.Material; private readonly glowMaterial: THREE.Material;
  private readonly ringMaterial: THREE.Material; private readonly domeMaterial: THREE.Material;
  private time = 0;
  private readonly strip: LightningStrip | null = null;
  private stripAt: THREE.Vector3 | null = null; private stripT = 0;
  constructor(scene: THREE.Scene, input: CloudBodyRows, private readonly pose: Readonly<Record<string, number>>, ports: ReadonlyMap<string, unknown> = new Map()) {
    const rows = this.rows = input;
    this.made = encounterMaterials(rows.materials);
    const loader = new THREE.BufferGeometryLoader();
    const built = createClientScene(rows.scene, { geometry: new Map(Object.entries(rows.geometry).map(([key, row]) => [key, loader.parse(row)])), materials: this.made });
    this.parts = built.parts;
    this.part(rows.root).scale.setScalar(rows.scale); scene.add(built.root);
    this.draw = installChannelPrograms(rows.poses, rows.group, new Map<string, unknown>([...built.parts, ...ports, ['pose', this.pose]]));
    this.list = rows.puffs.rows.map(row => {
      if (!rows.puffs.bones.includes(row.bone)) throw new Error(`Cloud puff on an undeclared bone: ${row.bone}`);
      return { bone: this.part(row.bone), p: new THREE.Vector3(...row.p), r: row.r, ph: row.ph };
    });
    const geometry = new THREE.IcosahedronGeometry(1, rows.puffs.detail);
    geometry.setAttribute('aAlbedo', new THREE.InstancedBufferAttribute(new Float32Array(rows.puffs.rows.flatMap(row => row.colour)), 3));
    this.puffs = new THREE.InstancedMesh(geometry, lentLook(rows.puffs.look), Math.max(1, this.list.length));
    this.puffs.frustumCulled = false; this.puffs.castShadow = false; this.puffs.receiveShadow = false; this.puffs.name = rows.puffs.name;
    scene.add(this.puffs);
    const f = rows.focus;
    if (rows.strip !== undefined) { this.strip = new LightningStrip(scene, rows.strip.segments, new THREE.Color(...rows.strip.colour)); this.strip.alpha = 0; }
    this.focusMaterial = this.materialOf(f.part); this.glowMaterial = this.materialOf(f.glow); this.ringMaterial = this.materialOf(f.ring); this.domeMaterial = this.materialOf(f.dome);
    this.setVisible(false);
  }
  part(key: string): THREE.Object3D { const object = this.parts.get(key); if (object === undefined) throw new Error(`Missing cloud body part ${key}`); return object; }
  setVisible(on: boolean): void {
    this.visible = on; this.puffs.visible = on;
    for (const key of this.rows.shown) this.part(key).visible = on;
    if (!on) { this.part(this.rows.focus.ring).visible = false; this.part(this.rows.focus.dome).visible = false; if (this.strip !== null) this.strip.alpha = 0; }
  }
  /** Point the strip at `target` (struck) or hold it out (`null`) at `alpha` (0 hides it). */
  aim(target: THREE.Vector3 | null, alpha: number): void {
    if (this.strip === null) return;
    this.stripAt = target; this.strip.alpha = alpha;
  }
  /** the focus's world position (after `update`) */
  focusWorld(out: THREE.Vector3): THREE.Vector3 { return this.part(this.rows.focus.part).getWorldPosition(out); }
  update(t: number, camera: Pick<THREE.Camera, 'position'>): void {
    const rows = this.rows, c = rows.puffs, f = rows.focus, open = this.pose[f.open] ?? 0, dt = Math.max(0, t - this.time);
    this.time = t;
    this.draw.evaluate({ time: t, delta: 0, values: {} });
    this.part(rows.root).updateMatrixWorld(true);
    for (let i = 0; i < this.list.length; i++) {
      const puff = this.list[i]; if (puff === undefined) continue;
      at.copy(puff.p).applyMatrix4(puff.bone.matrixWorld);
      const k = puff.r * (1 + c.swell[0] * Math.sin(t * c.swell[1] + puff.ph));
      at.x += Math.sin(t * c.drift[0] + puff.ph) * c.drift[2]; at.y += Math.sin(t * c.drift[1] + puff.ph * 1.7) * c.drift[2];
      this.puffs.setMatrixAt(i, matrix.compose(at, turn.setFromAxisAngle(up, t * c.spin + puff.ph), size.set(k, k * c.squash, k)));
    }
    this.puffs.instanceMatrix.needsUpdate = true;
    this.focusWorld(this.focusPoint);
    const focus = this.focusMaterial, glow = this.glowMaterial, ring = this.part(f.ring), [closed, opened] = f.colour;
    if (focus instanceof THREE.MeshBasicMaterial) focus.color.setRGB(closed[0] + (opened[0] - closed[0]) * open, closed[1] + (opened[1] - closed[1]) * open, closed[2] + (opened[2] - closed[2]) * open);
    if (isFx(glow)) { glow.uniforms.uAlpha.value = f.glowAlpha[0] + f.glowAlpha[1] * open; glow.uniforms.uTime.value = t; }
    this.glow.value = f.lookGlow[0] + f.lookGlow[1] * open;
    ring.visible = this.visible && open > 0.02;
    if (ring.visible) {
      ring.position.copy(this.focusPoint); ring.lookAt(camera.position); ring.rotateZ(t * f.spin);
      this.ringMaterial.opacity = open * (f.pulse[0] + f.pulse[1] * Math.sin(t * f.pulse[2]));
    }
    if (isFx(this.domeMaterial)) this.domeMaterial.uniforms.uTime.value = t;
    this.stripT -= dt;
    if (this.strip !== null && rows.strip !== undefined && this.stripT <= 0 && this.strip.alpha > 0) {
      const s = rows.strip, hand = this.part(s.from).getWorldPosition(at);
      this.stripT = s.every;
      if (this.stripAt !== null) this.strip.set(hand, this.stripAt, s.struck[0], s.struck[1]);
      else { this.part(s.back).getWorldPosition(size).sub(hand).multiplyScalar(-1).normalize().multiplyScalar(s.reach).add(hand); this.strip.set(hand, size, s.held[0], s.held[1]); }
    }
    this.syncLook();
  }
  /** push the look's params (also after the fight changes flash or alpha between updates) */
  syncLook(): void {
    const cloud = this.rows.puffs.look, p = this.rows.params, h = this.focusPoint, c = this.fogColour;
    setLentParam(cloud, p.time, this.time); setLentParam(cloud, p.focus, [h.x, h.y, h.z]); setLentParam(cloud, p.glow, this.glow.value);
    setLentParam(cloud, p.flash, this.flash.value); setLentParam(cloud, p.alpha, this.alpha.value);
    setLentParam(cloud, p.fogColour, [c.r, c.g, c.b]); setLentParam(cloud, p.fog, this.fog.value);
  }
  private materialOf(part: string): THREE.Material {
    const object = this.part(part);
    for (const made of this.made.values()) if (object instanceof THREE.Mesh && object.material === made) return made;
    throw new Error(`Cloud body part ${part} wears no declared material`);
  }
}
/** A cloud body's still specimen from its admitted rows (the tier's body at its pose, its ports' heights read from the
 *  terrain): standing on its lowest puff over the origin, its focus kept on the camera as it draws. */
export function cloudBodySpecimen(input: unknown): THREE.Group {
  const rows = v.parse(CloudSpecimenSchema, input), scene = new THREE.Scene(), body = TIER === 'phone' ? rows.phone : rows.desktop;
  const ports = new Map(Object.entries(rows.ports).map(([port, values]) => [port, Object.fromEntries(Object.entries(values).map(([key, value]) =>
    [key, typeof value === 'number' ? value : heightAt(...value.heightAt)]))]));
  const cloud = new CloudBody(scene, body, rows.pose, ports);
  cloud.setVisible(true); cloud.update(0, new THREE.PerspectiveCamera());
  const own = new THREE.Group();
  for (const child of scene.children.slice()) own.add(child);
  cloud.puffs.computeBoundingBox();
  const root = cloud.part(body.root), low = cloud.puffs.boundingBox?.min.y ?? root.position.y;
  own.position.set(-root.position.x, -low, -root.position.z);
  cloud.puffs.onBeforeRender = (): void => { cloud.focusWorld(cloud.focusPoint); cloud.syncLook(); };
  const group = new THREE.Group(); group.name = rows.name; group.add(own); return group;
}
function isMesh(value: unknown): value is THREE.Mesh { return value instanceof THREE.Mesh; }
function isInstances(value: unknown): value is THREE.InstancedMesh { return value instanceof THREE.InstancedMesh; }
function isFx(made: THREE.Material): made is FxMaterial { return made instanceof THREE.ShaderMaterial && 'uAlpha' in made.uniforms && 'uTime' in made.uniforms; }

/**
 * An arena's dressing: `scene` and its `geometry` in declared `materials`, its seal `wall` (those parts, standing at
 * `at` `sink` m into the ground) that rises with the seal at `ease`/s, each part spinning at its own `spin` rad/s, and
 * its ground `tells`.
 */
/** The arena's dressing built from rows; the caller lends its parts to the hazards that move them. */
export class ArenaSceneView {
  private readonly rows: ArenaSceneRows;
  private readonly parts: ReadonlyMap<string, THREE.Object3D>;
  private readonly wall: { readonly part: THREE.Object3D; readonly spin: number; readonly time: THREE.IUniform<number> | null }[];
  private readonly tellRows = new Map<string, GroundTell[]>();
  private rise = 0;
  constructor(scene: THREE.Scene, input: ArenaSceneRows) {
    const rows = this.rows = input, loader = new THREE.BufferGeometryLoader();
    const built = createClientScene(rows.scene, { geometry: new Map(Object.entries(rows.geometry).map(([key, row]) => [key, loader.parse(row)])), materials: encounterMaterials(rows.materials) });
    this.parts = built.parts;
    const [x, z] = rows.wall.at;
    this.wall = rows.wall.parts.map((key, i) => {
      const part = this.mesh(key), worn = part.material;
      part.position.set(x, heightAt(x, z) - rows.wall.sink, z);
      return { part, spin: rows.wall.spin[i] ?? 0, time: worn instanceof THREE.Material && isFx(worn) ? worn.uniforms.uTime : null };
    });
    scene.add(built.root);
    for (const [key, row] of Object.entries(rows.tells)) this.tellRows.set(key, Array.from({ length: row.count }, () => new GroundTell(scene, row.kind, new THREE.Color(...row.colour))));
  }
  /** a declared tell (its `index`th) */
  tell(key: string, index = 0): GroundTell { const tell = this.tellRows.get(key)?.[index]; if (tell === undefined) throw new Error(`Missing arena tell ${key}`); return tell; }
  /** every tell of an id */
  tells(key: string): readonly GroundTell[] { const tells = this.tellRows.get(key); if (tells === undefined) throw new Error(`Missing arena tell ${key}`); return tells; }
  mesh(key: string): THREE.Mesh { const part: unknown = this.parts.get(key); if (!isMesh(part)) throw new Error(`Missing arena mesh ${key}`); return part; }
  instances(key: string): THREE.InstancedMesh { const part: unknown = this.mesh(key); if (!isInstances(part)) throw new Error(`Missing arena instances ${key}`); return part; }
  /** the wall rises while `sealed` and sinks away after */
  update(dt: number, t: number, sealed: boolean): void {
    this.rise += ((sealed ? 1 : 0) - this.rise) * Math.min(1, dt * this.rows.wall.ease);
    for (const w of this.wall) {
      w.part.visible = this.rise > 0.02; w.part.scale.y = Math.max(0.02, this.rise); w.part.rotation.y += dt * w.spin;
      if (w.time !== null) w.time.value = t;
    }
    for (const tells of this.tellRows.values()) for (const tell of tells) tell.setTime(t);
  }
}
