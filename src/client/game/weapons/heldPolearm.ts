import {PolearmRowsSchema,type PolearmRows,type PolearmPresentation} from '@wildshard/format/heldMelee';
import { smoothstep as sstep } from '@wildshard/engine/core/noise';
import { gameplayRandom, app } from '@wildshard/engine/app/runtime';
import { aimRay, fovForAspect } from '@wildshard/engine/combat/blocks/melee';
import type { EquipContext } from '@wildshard/engine/combat/Equipment';
import type { Scope } from '@wildshard/engine/app/scope';
import { withOwner } from '@wildshard/engine/app/ownership';
import { ownSceneTree } from '@wildshard/engine/app/sceneOwnership';
import { Melee } from '@wildshard/engine/combat/Melee';
import type { MeleeProfile } from '@wildshard/engine/combat/meleeProfile';
import type { Targets, TargetAnimal, TargetHit } from '@wildshard/engine/combat/types';
import { impactSurfaceOf } from '@wildshard/engine/combat/impact';
import { worldHit, viewmodelMaterial } from '@wildshard/engine/combat/view/ranged';
import { quiverState, type WeaponState, type AimInfo } from '@wildshard/engine/combat/Weapon';
import type { Game } from '@wildshard/engine/core/Game';
import { weaponActionGate } from '@wildshard/engine/input/weaponActions';
import { floorBelow } from '@wildshard/engine/physics/query';
import type { AimTarget } from '@wildshard/engine/player/AimTargets';
import { targetRadius } from '@wildshard/engine/combat/lungeTarget';
import type { Player } from '@wildshard/engine/player/Player';
import { viewmodel } from '@wildshard/engine/render/viewmodelFeel';
import type { Forest } from '@wildshard/engine/world/forest/Forest';
import type { SkyRig as Sky } from '@wildshard/engine/world/skyRig';
import { terrainHeight as heightAt } from '@wildshard/engine/world/terrainHeight';
import * as THREE from 'three';
import * as schema from 'valibot';
import { ThrownWeaponProfileSchema } from '@wildshard/format/weaponProfiles';
import { PolearmContact } from '../../../shared/game/weapons/polearmContact';
import { createModelLibrary } from '@wildshard/engine/game/plugin/geometry';
import { ItemCatalogue } from '@wildshard/engine/game/loadout/itemCatalogue';
import { SWORD_WOOD } from '@wildshard/engine/game/weapons/starterMeleeProfile';
import type { ShardFolder } from '@wildshard/engine/game/shardfile/shardFolder';
import { painterlyMaterial } from '@wildshard/engine/world/painterly';
import { PolearmDecision } from '../../../shared/game/weapons/polearmDecision';
import { JavelinFlight } from '../../../shared/game/weapons/javelinFlight';

type JavelinProfile = schema.InferOutput<typeof ThrownWeaponProfileSchema>;

export interface HeldPolearmWorld { game: Game; sky: Sky; player: Player; forest: Forest }

export interface HeldPolearmMount { speed: number; yaw: number }

export interface HeldPolearmProfile extends MeleeProfile {
  readonly thrust: { readonly damage: number; readonly stagger: number; readonly windup: number; readonly activeEnd: number; readonly total: number;
    readonly fan: { readonly yaws: readonly number[]; readonly pitches: readonly number[] } };
  readonly lance: { readonly reach: number; readonly cone: number; readonly minSpeed: number; readonly baseDamage: number; readonly speedDamage: number; readonly rehit: number };
}


export interface HeldPolearmPose { readonly pos: THREE.Vector3; readonly q: THREE.Quaternion }

export interface HeldPolearmView {

  readonly poses: { readonly rest: HeldPolearmPose; readonly cock: HeldPolearmPose; readonly jab: HeldPolearmPose; readonly leftLow: HeldPolearmPose;
    readonly sprint: HeldPolearmPose; readonly lance: HeldPolearmPose; readonly javCock: HeldPolearmPose; readonly javOut: HeldPolearmPose };

  readonly elbows: { readonly left: THREE.Vector3; readonly right: THREE.Vector3 };

  readonly tapMax: number;
  readonly javelinGrip: number;
  readonly wrists: { readonly left: THREE.Vector3; readonly right: THREE.Vector3 };
}

export interface HeldPolearmOptions<P extends HeldPolearmProfile> {
  readonly profile: P;
  readonly javelin: JavelinProfile;
  readonly view: HeldPolearmView;
  readonly program: unknown;
  readonly geometry: ReadonlyMap<string,THREE.BufferGeometry> | (() => Promise<ReadonlyMap<string,THREE.BufferGeometry>>);
  readonly presentation: PolearmPresentation;
  readonly allowUnlocked?: boolean;
  readonly owner?: Scope;
}

const Y = new THREE.Vector3(0, 1, 0);
const _commandOrigin = new THREE.Vector3(), _commandRotation = new THREE.Quaternion();

interface Jav { state: 0 | 1 | 2; pos: THREE.Vector3; vel: THREE.Vector3; q: THREE.Quaternion; age: number }  // 0 none · 1 flying · 2 stuck
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _dir = new THREE.Vector3(), _fwd = new THREE.Vector3();
const _head = new THREE.Vector3(), _arcPrev = new THREE.Vector3();

function floorUnder(x: number, y: number, z: number): number {
  const ph = app.physics;
  return (ph ? floorBelow(ph, x, z, y, 60) : undefined) ?? heightAt(x, z);
}
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler(), _m = new THREE.Matrix4(), _s1 = new THREE.Vector3(1, 1, 1);
const _vThrow = new THREE.Vector3(), _qThrow = new THREE.Quaternion(), _vCock = new THREE.Vector3(), _qCock = new THREE.Quaternion();
const _qSway = new THREE.Quaternion(), _qHol = new THREE.Quaternion(), _vArm = new THREE.Vector3(), _vEl = new THREE.Vector3();

export class HeldPolearm<P extends HeldPolearmProfile = HeldPolearmProfile> extends Melee<P> {
  override readonly reach: number = this.profile.reach;
  readonly state: WeaponState;
  enabled = true;
  allowUnlocked = false;

  adsHeld = false;

  holster = 0;

  mount: HeldPolearmMount | null = null;

  private readonly projectile: JavelinProfile;
  javelins: number;
  get maxJavelins(): number { return this.projectile.carried; }

  damageScale=1;

  showArc = true;
  aimInfo: AimInfo | null = null;

  inspect = 0;

  onThrow?: () => void;
  onPickup?: (n: number) => void;

  readonly model: THREE.Group = new THREE.Group();
  private game: Game; private sky: Sky; private player: Player;
  private targets: Targets | undefined;
  private spearRig = new THREE.Group(); private handRig = new THREE.Group();
  private heldJav: THREE.Group = new THREE.Group();
  private leftArm: THREE.Mesh = new THREE.Mesh(); private rightArm: THREE.Mesh = new THREE.Mesh();
  private leftWrist = new THREE.Vector3(); private rightWrist = new THREE.Vector3();
  private arc: THREE.Points = new THREE.Points(); private arcPos: Float32Array; private arcAttr: THREE.BufferAttribute = new THREE.BufferAttribute(new Float32Array(),3); private arcMat: THREE.PointsMaterial = new THREE.PointsMaterial();
  private worldDraw: THREE.InstancedMesh | null = null;
  private get world(): THREE.InstancedMesh { if (this.worldDraw === null) throw new Error('Polearm view is not prepared'); return this.worldDraw; }
  private visualReady = false;
  private viewPending: Promise<void> | undefined;
  private viewOwner: Scope;
  private javs: Jav[] = [];

  private rmbDown = false; private rmbT = 0;


  private lanceBlend = 0;

  private lastYaw = 0; private lastPitch = 0; private lagYaw = 0; private lagYawVel = 0; private lagPitch = 0; private lagPitchVel = 0;
  private fov = this.profile.feel.fovHip; private baseFov = 0; private jolt = 0; private sprintBlend = 0;
  private throwBlend = 0; private inHand = false; private aimFrame = 0;
  private aimCache: AimInfo = { kind: 'deer', distance: 0 };

  private readonly view: HeldPolearmView;
  /** the thrust / lance / javelin decisions (renderer-free, CI12) */
  private readonly law:PolearmDecision<AimTarget>;
  /** the javelins' throw, flight and landing (renderer-free, CI12) */
  private readonly flight:JavelinFlight<TargetHit>;
  private geometry:ReadonlyMap<string,THREE.BufferGeometry>;
  private readonly readGeometry: (() => Promise<ReadonlyMap<string,THREE.BufferGeometry>>) | undefined;
  private readonly presentation:PolearmPresentation;

  constructor(w: HeldPolearmWorld, targets: Targets | undefined, opts: HeldPolearmOptions<P>) {
    super(opts.profile, app.combat);
    const carried = opts.javelin.carried;
    this.state = quiverState({ bolts: carried, loaded: true, reloading: false, reloadProgress: 0, ads: false }, carried);
    this.projectile = opts.javelin; this.javelins = carried;
    for (let i = 0; i < this.projectile.pool; i++) this.javs.push({ state: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), q: new THREE.Quaternion(), age: 0 });
    this.arcPos = new Float32Array(this.projectile.arcPoints * 3);
    this.view = opts.view;this.law=new PolearmDecision<AimTarget>(opts.program,w.game.levelScope);this.presentation=opts.presentation;
    this.contactLaw=new PolearmContact<AimTarget>({raycast:targets===undefined?null:(origin,dir,max)=>targets.raycast(origin,dir,max),
      contact:(animal,amount,point,dir,from,moveId)=>this.contact(animal,amount,point,dir,from,moveId),same:(animal,target)=>this.same(animal,target),
      struck:(hit,killed)=>{this.onHit?.(hit.animal.kind,false,killed);this.onImpact?.('flesh',hit.point);}},this.law);
    this.viewOwner=opts.owner??w.game.levelScope;
    this.readGeometry=typeof opts.geometry==='function'?opts.geometry:undefined;
    this.geometry=typeof opts.geometry==='function'?new Map():opts.geometry;
    this.row = { ...this.row, ui: { ...this.row.ui, inputContext: opts.profile.id } };
    this.game = w.game; this.sky = w.sky; this.player = w.player;
    this.flight = new JavelinFlight<TargetHit>(this.javs, this.projectile, {
      worldHit: (from, to, radius) => worldHit(from, to, radius),
      raycast: targets === undefined ? null : (origin, dir, max) => targets.raycast(origin, dir, max),
      strike: (hit, dmg, dir) => {
        const killed = hit.animal.applyDamage(dmg, hit.point, dir);
        if (!killed) hit.animal.stagger?.(_v2.set(dir.x, 0, dir.z).normalize(), this.projectile.stagger);
        this.onHit?.(hit.animal.kind, hit.headshot, killed);
        this.onImpact?.('flesh', hit.point);
      },
      impact: (surface, at) => { this.onImpact?.(surface, at); },
      water: (x, z) => this.player.waterSurfaceAt(x, z),
      floor: floorUnder, random: gameplayRandom, surface: impactSurfaceOf, damageScale: () => this.damageScale,
    });
    this.setAimSource(() => this.player.sampleAimCommand());
    this.targets = targets;
    this.allowUnlocked = opts.allowUnlocked ?? false;
    this.lastYaw = this.player.yaw; this.lastPitch = this.player.pitch;
    if(this.readGeometry===undefined){this.worldDraw=this.build();this.visualReady=true;}
    const cam = this.game.camera;
    this.game.viewmodel.mountOwnPass(this.model, cam); // its own depth clear; staged while its cell prepares (op-hitch41)
    if (!cam.parent) this.game.scene.add(cam);
    this.aimBlock = aimRay(() => this.player.sampleAimCommand()); this.blocks.aim = this.aimBlock; this.blocks.vm = this.lookBlock;
  }

  override get segments(): number { return this.maxJavelins; }
  get magazine(): number { return this.maxJavelins; }

  override addBolts(n: number): void { this.javelins = Math.min(this.maxJavelins, this.javelins + Math.max(0, n)); }

  private readonly lookBlock = viewmodel(this.profile.feel.lag);
  private readonly lookState = { yaw: 0, pitch: 0, yawVelocity: 0, pitchVelocity: 0 };
  private readonly lookDelta = new THREE.Vector2();
  private readonly aimBlock: ReturnType<typeof aimRay>;
  /** the thrust's and the lance's contact (renderer-free, CI12) */
  private readonly contactLaw: PolearmContact<AimTarget>;
  override install(ctx: EquipContext): void {
    super.install(ctx); this.bindInput(ctx);
    this.viewOwner=ctx.scope;
    ctx.scope.onDispose(() => { this.model.removeFromParent(); this.worldDraw?.removeFromParent(); this.arc.removeFromParent(); });
  }
  /** Native profiles/state exist before control. Only an explicitly deferred
   * pool and its exact visual parts wait for the service's first-select fence. */
  get needsPreparation():boolean{return !this.visualReady;}
  prepareView():Promise<void>{
    if(this.visualReady)return Promise.resolve();
    const owner=this.viewOwner;
    const live=():boolean=>this.viewOwner===owner&&!owner.disposed&&!owner.disposing;
    const check=():void=>{if(!live())throw new Error('Polearm preparation owner left');};
    check();
    this.viewPending??=(async()=>{
      try{
        if(this.worldDraw===null){
          const read=this.readGeometry;if(read===undefined)throw new Error('Polearm geometry has no preparation');
          this.geometry=await read();check();
          this.worldDraw=withOwner(owner,()=>this.build());
          ownSceneTree(this.model,owner,app.assets);ownSceneTree(this.worldDraw,owner,app.assets);ownSceneTree(this.arc,owner,app.assets);
        }
        await this.game.warmSceneRoots([this.model,this.worldDraw],live);check();
        this.visualReady=true;
      }catch(error:unknown){this.viewPending=undefined;throw error;}
    })();
    return this.viewPending;
  }
  override setActive(on:boolean):void{if(on&&!this.visualReady)throw new Error('Polearm view is not prepared');super.setActive(on);}
  private bindInput(ctx: EquipContext): void {
    const allowed = weaponActionGate(this, this.player);
    app.input.bind('attack', () => { this.tryFire(); }, ctx.scope, allowed);
    app.input.bind('aim', () => { this.rmbDown = true; this.rmbT = 0; }, ctx.scope, allowed);
    app.input.bindRelease('aim', () => { if (!this.rmbDown) return; this.rmbDown = false; if (allowed() && this.rmbT < this.view.tapMax) this.requestThrow(); }, ctx.scope);
    app.input.onReset(() => { this.rmbDown = false; }, ctx.scope);
  }

  tryFire():void{this.law.attackPending=true;}
  private requestThrow():void{this.law.tapPending=true;}
  private part(name:string):THREE.BufferGeometry{const part=this.geometry.get(name);if(part===undefined)throw new Error(`Missing polearm part ${name}`);return part.clone();}
  private decide(dt:number,t:number):void{
   const out=this.law.decide(dt,t,{player:this.player.position,heading:this.mount?.yaw??this.player.yaw,held:this.model.visible,enabled:this.enabled,ads:this.adsHeld,
    ammo:this.javelins,capacity:this.maxJavelins,mount:this.mount,targets:app.aimTargets,radius:targetRadius,javelins:this.javs,random:gameplayRandom,policy:this.profile,projectile:this.projectile});
   if(out===null)return;
   if(out.start)this.onFire?.();if(out.dry)this.onDry?.();if(out.charge)this.chargeEvent('throw',0);if(out.launch)this.launch();if(out.strike)this.thrustHit();
   if(out.target!==undefined)this.lanceContact(out.target,out.damage,t);
   const j=this.javs[out.pickup];if(j!==undefined){j.state=0;if(out.recover){this.javelins++;this.onPickup?.(this.javelins);this.chargeEvent('recover',this.javelins);}}
  }
  private build(): THREE.InstancedMesh {
    const look=this.presentation.materials;
    const mat = painterlyMaterial(this.sky, { vertexColors: true, rim: look.rim, bands: look.bands, transparent: true, depthWrite: true }); mat.name = 'held-viewmodel';
    const steel = viewmodelMaterial(this.sky, 'held-steel', { metalness: look.metalness, roughness: look.roughness, envMapIntensity: look.environment }); steel.transparent = true; steel.depthWrite = true;
    this.leftWrist.copy(this.view.wrists.left); this.rightWrist.copy(this.view.wrists.right);
    this.leftArm = new THREE.Mesh(this.part(this.presentation.parts.leftArm), mat); this.rightArm = new THREE.Mesh(this.part(this.presentation.parts.rightArm), mat);
    for (const a of [this.leftArm, this.rightArm]) { a.frustumCulled = false; a.renderOrder = 1000; a.receiveShadow = true; this.model.add(a); }
    const add = (g: THREE.BufferGeometry, m: THREE.Material, to: THREE.Object3D) => {
      const mesh = new THREE.Mesh(g, m);
      mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = true; mesh.renderOrder = 1000;
      to.add(mesh);
    };
    add(this.part(this.presentation.parts.body), mat, this.spearRig); add(this.part(this.presentation.parts.metal), steel, this.spearRig);
    add(this.part(this.presentation.parts.fist), mat, this.handRig);
    this.heldJav = new THREE.Group();
    add(this.part(this.presentation.parts.projectile), mat, this.heldJav); add(this.part(this.presentation.parts.projectileMetal), steel, this.heldJav);
    this.heldJav.visible = false;
    this.heldJav.position.set(0, this.view.javelinGrip, 0); // the right hand grips it just behind the balance point
    this.handRig.add(this.heldJav);
    this.model.add(this.spearRig, this.handRig);

    const clearer = new THREE.Mesh(new THREE.BoxGeometry(0.001, 0.001, 0.001), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, transparent: true, fog: false }));
    clearer.renderOrder = 999; clearer.frustumCulled = false;
    clearer.onBeforeRender = (renderer) => { renderer.clearDepth(); };
    this.model.add(clearer);

    const ag = new THREE.BufferGeometry();
    ag.setAttribute('position', (this.arcAttr = new THREE.BufferAttribute(this.arcPos, 3)));
    this.arcAttr.setUsage(THREE.DynamicDrawUsage);
    ag.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.arcMat = new THREE.PointsMaterial({ color: this.presentation.arc.color, size: this.presentation.arc.size, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false, toneMapped: false });
    this.arc = new THREE.Points(ag, this.arcMat);
    this.arc.frustumCulled = false; this.arc.renderOrder = 1003; this.arc.visible = false;
    this.game.scene.add(this.arc);

    const world = new THREE.InstancedMesh(this.part(this.presentation.parts.world), painterlyMaterial(this.sky, { vertexColors: true, rim: look.worldRim }), this.projectile.pool);
    world.count = 0; world.castShadow = true; world.receiveShadow = true; world.frustumCulled = false;
    this.game.scene.add(world);
    return world;
  }

  private launch(): void {
    if (!this.flight.free() || this.javelins <= 0) return;
    this.javelins--;
    this.aimPose(_commandOrigin, _commandRotation);
    this.aimRay(_commandOrigin, _fwd);
    this.flight.launch(_commandOrigin, _commandRotation, _fwd, this.mount);
    this.chargeEvent('throw', 1); this.onFire?.(); this.onThrow?.();
  }
  private flyJavelins(dt: number): void {
    this.flight.fly(dt);

    if(this.worldDraw===null)return;
    let n = 0;
    for (const j of this.javs) {
      if (j.state === 0) continue;
      this.world.setMatrixAt(n++, _m.compose(j.pos, j.q, _s1));
    }
    if (n !== this.world.count || n > 0) { this.world.count = n; this.world.instanceMatrix.needsUpdate = true; }
  }

  private drawArc(alpha: number): void {
    this.arc.visible = alpha > 0.01;
    this.arcMat.opacity = alpha * 0.85;
    if (!this.arc.visible) return;
    this.aimPose(_commandOrigin, _commandRotation);
    this.aimRay(_commandOrigin, _fwd);
    _v1.set(0.22, 0.05, -0.3).applyQuaternion(_commandRotation).add(_commandOrigin);
    _v2.set(1, 0, 0).applyQuaternion(_commandRotation);
    _dir.copy(_fwd).applyAxisAngle(_v2, 0.035).normalize().multiplyScalar(this.projectile.speed);
    const P = this.arcPos;
    let hitAt = this.projectile.arcPoints;
    for (let i = 0; i < this.projectile.arcPoints; i++) {
      const t = 0.06 + i * 0.05; // 1.6 s of flight ≈ 40 m
      let x = _v1.x + _dir.x * t, y = _v1.y + _dir.y * t - 0.5 * this.projectile.gravity * t * t, z = _v1.z + _dir.z * t;
      if (i >= hitAt) { x = P[(hitAt - 1) * 3] ?? x; y = P[(hitAt - 1) * 3 + 1] ?? y; z = P[(hitAt - 1) * 3 + 2] ?? z; }
      else if (i > 0) {
        _head.set(x, y, z);
        const wall = worldHit(_arcPrev.set(P[(i - 1) * 3] ?? x, P[(i - 1) * 3 + 1] ?? y, P[(i - 1) * 3 + 2] ?? z), _head, 0);
        if (wall) { hitAt = i; x = wall.point.x; y = wall.point.y + 0.05; z = wall.point.z; }
      }
      P[i * 3] = x; P[i * 3 + 1] = y; P[i * 3 + 2] = z;
    }
    this.arcAttr.needsUpdate = true;
  }

  private lanceContact(a:AimTarget,dmg:number,t:number):void{
   this.aimPose(_commandOrigin,_commandRotation);
   if(this.contactLaw.lance(_commandOrigin,a,dmg,t,this.player.position)!==null)this.jolt=1.4;
  }
  private same(a: TargetAnimal, b: AimTarget): boolean { return a.position === b.position; }

  private thrustHit(): void {
    if (this.targets === undefined) return;
    this.aimPose(_commandOrigin, _commandRotation);
    this.aimRay(_commandOrigin, _fwd);
    if (this.contactLaw.thrust(_commandOrigin, _commandRotation, _fwd, this.profile) !== null) this.jolt = 1;
  }

  update(dt: number, t: number): void {
    const p = this.player, cam = this.game.camera;
    const inHand = this.model.visible;
    if (!inHand || !this.enabled) this.rmbDown = false;
    this.law.stow(inHand, this.enabled);
    if (inHand !== this.inHand) { this.inHand = inHand; if (!inHand) { p.moveScale = 1; p.swinging = false; } }

    if (inHand) {

      const baseFov = fovForAspect(this.profile.feel.fovHip, cam.aspect);
      const target = baseFov + p.fovKick;
      if (Math.abs(target - this.fov) > 0.01) {
        const refit = Math.abs(baseFov - this.baseFov) > 0.01; this.baseFov = baseFov;
        this.fov = target; cam.fov = target; cam.updateProjectionMatrix();
        if (refit) this.sky.csm.updateFrustums();
      }
    }

    if (this.rmbDown) this.rmbT += dt;
    p.moveScale = 1;

    this.decide(dt,t);
    const lance=this.law.lanceActive;
    if(inHand)p.swinging=this.law.thrustT>=0;
    this.flyJavelins(dt);
    this.state.bolts = this.javelins; this.state.loaded = this.javelins > 0; this.state.ads = this.law.windT >= 0;

    const thrustPose=this.law.thrustT<0?-1:this.law.thrustT+this.law.decisionT,windPose=this.law.windT<0?-1:this.law.windT+this.law.decisionT,throwPose=this.law.throwT<0?-1:this.law.throwT+this.law.decisionT;
    this.jolt *= Math.exp(-dt * 14);
    const throwing = windPose >= 0 || throwPose >= 0;
    this.throwBlend += ((throwing ? 1 : 0) - this.throwBlend) * (1 - Math.exp(-dt * (throwing ? 16 : 8)));
    this.lanceBlend += ((lance ? 1 : 0) - this.lanceBlend) * (1 - Math.exp(-dt * 6));
    this.sprintBlend += ((p.sprinting && thrustPose < 0 && !throwing ? 1 : 0) - this.sprintBlend) * Math.min(1, dt * 7);

    let dYaw = p.yaw - this.lastYaw, dPitch = p.pitch - this.lastPitch;
    this.lastYaw = p.yaw; this.lastPitch = p.pitch;
    if (Math.abs(dYaw) > 1) dYaw = 0; if (Math.abs(dPitch) > 1) dPitch = 0;
    this.lookState.yaw = this.lagYaw; this.lookState.pitch = this.lagPitch;
    this.lookState.yawVelocity = this.lagYawVel; this.lookState.pitchVelocity = this.lagPitchVel;
    this.lookBlock.step(this.lookState, this.lookDelta.set(dYaw, dPitch), dt);
    this.lagYaw = this.lookState.yaw; this.lagPitch = this.lookState.pitch;
    this.lagYawVel = this.lookState.yawVelocity; this.lagPitchVel = this.lookState.pitchVelocity;
    if(!this.visualReady)return;

    const sp = _v1, sq = _q, { rest: REST, cock: COCK, jab: JAB, leftLow: LEFT_LOW, sprint: SPRINT, lance: LANCE, javCock: JAV_COCK, javOut: JAV_OUT } = this.view.poses;
    sp.copy(REST.pos); sq.copy(REST.q);
    if (thrustPose >= 0) {
      const tt = thrustPose;
      if (tt < this.profile.thrust.windup) { const f = sstep(0, 1, tt / this.profile.thrust.windup); sp.lerp(COCK.pos, f); sq.slerp(COCK.q, f); }
      else if (tt < this.profile.thrust.activeEnd) { const f = 1 - (1 - (tt - this.profile.thrust.windup) / (this.profile.thrust.activeEnd - this.profile.thrust.windup)) ** 3; sp.copy(COCK.pos).lerp(JAB.pos, f); sq.copy(COCK.q).slerp(JAB.q, f); }
      else { const f = sstep(0, 1, (tt - this.profile.thrust.activeEnd) / (this.profile.thrust.total - this.profile.thrust.activeEnd)); sp.copy(JAB.pos).lerp(REST.pos, f); sq.copy(JAB.q).slerp(REST.q, f); }
    }
    const lb = sstep(0, 1, this.lanceBlend), tb = sstep(0, 1, this.throwBlend), sb = this.sprintBlend;
    if (lb > 0) { sp.lerp(LANCE.pos, lb); sq.slerp(LANCE.q, lb); }
    if (sb > 0) { sp.lerp(SPRINT.pos, sb); sq.slerp(SPRINT.q, sb); }

    const hp = _v2.copy(sp), hq = _q2.copy(sq);
    if (tb > 0) {

      sp.lerp(_v3.copy(LEFT_LOW.pos), tb); sq.slerp(LEFT_LOW.q, tb);
      let jp = JAV_COCK.pos, jq = JAV_COCK.q;
      let wind = 1;
      if (windPose >= 0) wind = sstep(0, 1, windPose / this.projectile.windup);
      if (throwPose >= 0) {
        const f = throwPose < this.projectile.release ? 1 - (1 - throwPose / this.projectile.release) ** 2 : 1;
        jp = _vThrow.copy(JAV_COCK.pos).lerp(JAV_OUT.pos, f); jq = _qThrow.copy(JAV_COCK.q).slerp(JAV_OUT.q, f);
      }
      _vCock.copy(REST.pos).lerp(jp, wind); _qCock.copy(REST.q).slerp(jq, wind);
      if (windPose >= 0) { _vCock.x += Math.sin(t * 31) * 0.002 * wind; _vCock.z += 0.02 * wind * sstep(0.6, 1, windPose / this.projectile.windup); } // drawn back taut
      hp.lerp(_vCock, tb); hq.slerp(_qCock, tb);
    }
    this.heldJav.visible = (windPose >= 0 || (throwPose >= 0 && !this.law.threw)) && this.javelins > 0;

    const sf = p.speedFactor, m = 1;
    const swX = Math.sin(t * this.profile.feel.sway.fx) * this.profile.feel.sway.ax, swY = Math.sin(t * this.profile.feel.sway.fy) * this.profile.feel.sway.ay;
    const bobX = Math.cos(p.bobTime) * this.profile.feel.bob.x * sf, bobY = -Math.abs(Math.sin(p.bobTime)) * this.profile.feel.bob.y * sf;
    _e.set((Math.sin(p.bobTime * 2) * this.profile.feel.bob.rx * sf + this.lagPitch + this.jolt * 0.05) * m, this.lagYaw * m, (Math.sin(t * 0.5) * 0.006 + Math.cos(p.bobTime) * this.profile.feel.bob.rz * sf) * m, 'YXZ');
    _qSway.setFromEuler(_e);
    const portrait = cam.aspect < 1 ? Math.min(1, (1 - cam.aspect) * 1.6) : 0;
    const scale = 1 - portrait * 0.15;
    const h = this.holster > 0 ? sstep(0, 1, this.holster) : 0;
    if (h > 0) _qHol.setFromEuler(_e.set(-h * 0.6, 0, h * 0.3, 'YXZ'));
    for (const [pos, q, rig] of [[sp, sq, this.spearRig], [hp, hq, this.handRig]] as [THREE.Vector3, THREE.Quaternion, THREE.Group][]) {
      pos.x += (swX + bobX + this.lagYaw * this.profile.feel.lag.posYaw) * m; pos.y += (swY + bobY + this.lagPitch * this.profile.feel.lag.posPitch) * m; pos.z += this.jolt * 0.04;
      q.premultiply(_qSway);
      pos.x *= 1 - portrait * 0.3; pos.y *= 1 + portrait * 0.08; pos.z *= 1 + portrait * 0.25;
      if (h > 0) { pos.y -= h * 0.5; pos.z += h * 0.1; q.premultiply(_qHol); }
      if (this.inspect) { pos.set(0.05, -0.1, -1.1); q.setFromEuler(_e.set(0.3, Math.sin(t * 0.3) * 0.6, 1.3, 'YXZ')); }
      rig.position.copy(pos); rig.quaternion.copy(q); rig.scale.setScalar(scale);
    }

    for (const [rig, wrist, elbow, arm] of [[this.spearRig, this.leftWrist, this.view.elbows.left, this.leftArm], [this.handRig, this.rightWrist, this.view.elbows.right, this.rightArm]] as [THREE.Group, THREE.Vector3, THREE.Vector3, THREE.Mesh][]) {
      rig.updateMatrix();
      _vArm.copy(wrist).applyMatrix4(rig.matrix);
      _vEl.set(elbow.x * (1 - portrait * 0.3), elbow.y - h * 0.5, elbow.z);
      arm.position.copy(_vArm);arm.quaternion.setFromUnitVectors(Y,_vEl.sub(_vArm).normalize());
      arm.scale.setScalar(scale);
    }

    const arcAlpha = this.showArc && inHand && windPose >= this.projectile.arcAfter ? sstep(this.projectile.arcAfter, this.projectile.windup, windPose) : 0;
    this.drawArc(arcAlpha);

    if (this.targets && inHand && (++this.aimFrame & 3) === 0) {
      this.aimRay(_commandOrigin, _fwd);
      const hit = this.targets.raycast(_commandOrigin, _fwd, 120);
      if (hit?.animal.alive) { this.aimCache.kind = hit.animal.kind; this.aimCache.distance = hit.distance; this.aimInfo = this.aimCache; }
      else this.aimInfo = null;
    }
  }

}

type PolearmData=schema.InferOutput<typeof PolearmRowsSchema>;
const spearPose=(row:PolearmRows['view']['poses']['rest']):HeldPolearmPose=>({pos:new THREE.Vector3(...row.pos),q:new THREE.Quaternion(...row.q)});
/** Client-only native polearm binding. Model parts, view poses, physics policy and
 * the <=10 Hz guest are admitted rows; no shard callbacks or subclasses. */
export class PolearmSet {
 private data:{parts:ReturnType<typeof createModelLibrary<never,never>>;profile:HeldPolearmProfile;javelin:JavelinProfile;view:HeldPolearmView;rows:PolearmData;deferred:boolean}|null=null;
 constructor(private readonly rows:{file:string;item:`weapon.${string}`}){}
 readonly Weapon:new(world:HeldPolearmWorld,targets?:Targets,opts?:{allowUnlocked?:boolean;profile?:HeldPolearmProfile;owner?:Scope})=>HeldPolearm=((owner:PolearmSet)=>class extends HeldPolearm {
  constructor(world:HeldPolearmWorld,targets?:Targets,opts:{allowUnlocked?:boolean;profile?:HeldPolearmProfile;owner?:Scope}={}){
   const r=owner.need();
   const geometries=():ReadonlyMap<string,THREE.BufferGeometry>=>new Map(r.rows.pool.parts.map(id=>{
    const part=r.parts.geometry(id);if(part===null)throw new Error(`Missing polearm part ${id}`);return [id,part] as const;
   }));
   super(world,targets,{profile:opts.profile??r.profile,javelin:r.javelin,view:r.view,allowUnlocked:opts.allowUnlocked??false,...(opts.owner===undefined?{}:{owner:opts.owner}),program:r.rows.program,presentation:r.rows.presentation,
    geometry:r.deferred?async()=>{await r.parts.preload();const sourceOwner=opts.owner??world.game.levelScope;if(sourceOwner.disposed||sourceOwner.disposing)throw new Error('Polearm preparation owner left');return geometries();}:geometries()});
  }
 })(this);
 private need():NonNullable<PolearmSet['data']>{if(this.data===null)throw new Error('Polearm rows not prepared');return this.data;}
 async prepare(product:Pick<ShardFolder,'file'|'shardfile'|'hasFile'|'url'>,options?:{readonly geometry:'on-select'}):Promise<void>{
  const rows=schema.parse(PolearmRowsSchema,JSON.parse(new TextDecoder().decode(await product.file(this.rows.file))));
  // a pool the product names (GR6) loads by its content-addressed URL; any other pool URL is fetched as written
  const pool=product.hasFile(rows.pool.url)?{...rows.pool,url:product.url(rows.pool.url)}:rows.pool;
  const item=product.shardfile.items.rows.find(row=>row.id===this.rows.item);
  const javelin=schema.parse(ThrownWeaponProfileSchema,item?.kind==='weapon'?item.profile:undefined);
  const parts=createModelLibrary<never,never>({meshes:[],hd:[],meshUrls:{},hdUrls:{},hdLooks:{},aoFloor:1,geometryPools:[pool]},'held-polearm');
  const deferred=options?.geometry==='on-select';if(!deferred)await parts.preload();
  const p=rows.view.poses;
  this.data={parts,rows,deferred,profile:{...SWORD_WOOD,...new ItemCatalogue(product.shardfile.items).equipment(this.rows.item),parent:SWORD_WOOD.id,...rows.profile},javelin,view:{...rows.view,poses:{rest:spearPose(p.rest),cock:spearPose(p.cock),jab:spearPose(p.jab),leftLow:spearPose(p.leftLow),sprint:spearPose(p.sprint),lance:spearPose(p.lance),javCock:spearPose(p.javCock),javOut:spearPose(p.javOut)},wrists:{left:new THREE.Vector3(...rows.view.wrists.left),right:new THREE.Vector3(...rows.view.wrists.right)},elbows:{left:new THREE.Vector3(...rows.view.elbows.left),right:new THREE.Vector3(...rows.view.elbows.right)}}};
 }
 geometry(name:string):THREE.BufferGeometry{const part=this.need().parts.geometry(name);if(part===null)throw new Error(`Missing polearm part ${name}`);return part;}
 profile():HeldPolearmProfile{return this.need().profile;}
}
