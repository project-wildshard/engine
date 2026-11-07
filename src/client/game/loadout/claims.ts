import * as THREE from 'three';
import * as v from 'valibot';
import { isJsonData } from '@wildshard/format/json';
import { cacheUntilDisposed } from '@wildshard/engine/app/disposalCache';
import { Rng } from '@wildshard/engine/core/rng';
import { emitFault } from '@wildshard/engine/core/faults';
import { LightPool } from '@wildshard/engine/fx/LightPool';
import { ItemPickup } from '@wildshard/engine/player/WeaponPickup';
import { InteractSfx } from '@wildshard/engine/audio/interactSfx';
import type { Interactable } from '@wildshard/engine/world/interact/types';
import { applyMeleeCombatProfile, type MeleeProfile } from '@wildshard/engine/combat/meleeProfile';
import type { RosterEntry } from '@wildshard/engine/models/live';
import { HeldArmsSchema, parseHeldSlots, type HeldSlotsRows, type HeldArmsRows } from '@wildshard/format/heldArms';
import type { ShardContext } from '../plugin/context';
import { createOwnedGeometry, type OwnedGeometry } from '@wildshard/engine/models/ownedGeometry';
import { createClientScene } from '../plugin/scene';
import { bindRuntimeEquipment, bindRuntimeItems } from '../plugin/headless';
import { sameRuntimeProfile } from '../../../shared/game/plugin/runtimeRows';
import { ItemCatalogue } from '../../../shared/game/loadout/itemCatalogue';
import { heldArmsGear } from '../models/heldGear';
import { HeldView } from '../systems/viewmodel/heldView';
import { SWORD_WOOD, SWORD_IRON } from '../../../shared/game/weapons/starterMeleeProfile';
import { Sword } from '../weapons/Sword';
import { type HeldBowFileRows, MeleeWeaponProfileSchema, FirearmWeaponProfileSchema } from '@wildshard/format/weaponProfiles';
import type { SwordWorld } from '@wildshard/engine/combat/view/melee';
import type { Targets, TargetAnimal } from '@wildshard/engine/combat/types';
import { GrappleTool, grappleGuard } from '../grapple/tool';
import { parseGrappleProfile, GrappleProfileSchema, GrappleHooksSchema, type GrappleRows } from '@wildshard/format/grapple';
import { QuestStepRunner, type QuestStepFrame } from '../../../shared/game/quest/steps';

import { macrotask } from '@wildshard/engine/boot/plan';
import type { Scope } from '@wildshard/engine/app/scope';
import type { Weapon } from '@wildshard/engine/combat/Weapon';
import type { EquipmentService } from '@wildshard/engine/combat/EquipmentService';
import { BladeSet } from '../weapons/mountedBlade';
import { PolearmSet, type HeldPolearmWorld } from '../weapons/heldPolearm';
import { Bow } from '../weapons/Bow';
import { bindHeldBow } from '../weapons/heldLauncher';
import { HeldFirearm, type HeldFirearmProfile, type HeldFirearmView, type HeldFirearmRows } from '../plugin/heldFirearm';
import type { BowVariantRows } from '@wildshard/format/bowVariantRows';
import { equipmentActorOwner } from './actors';
import { ReturnProgram } from '../../../shared/game/population/returnProgram';
import { ProjectedTrail } from '@wildshard/engine/combat/view/projectedTrail';
import type { ArcWeaponPower } from '../weapons/arcPower';
import type { ShardProduct } from '../../../shared/game/shardfile/shardProduct';
import { SpecimenBookSchema } from '@wildshard/format/specimenCatalogue';
import { defineSpecimenCatalogue,prepareSpecimenCatalogue } from '../models/specimenCatalogue';
import { createModelLibrary } from '../plugin/geometry';
import type { ModelDef } from '@wildshard/engine/models/model';

type EquipmentBuilder = NonNullable<NonNullable<ShardContext['game']['runtime']>['buildEquipment']>;
/** The original built primary and its admitted native combat profile. */
export interface HeldMeleeOwner {
  readonly profile: v.InferOutput<typeof MeleeWeaponProfileSchema>;
  readonly primary: () => Sword;
}

/** The same native sword recipe over the declared view loan. */
function heldSword(world: SwordWorld, targets: Targets, allowUnlocked: boolean,
  viewmodel: Parameters<EquipmentBuilder>[2], profile: MeleeProfile, view: 'wood' | 'iron' | 'declared'): Sword {
  if (view === 'declared') {
    const { ironArms: _iron, swim: _swim, ...own } = viewmodel ?? {};
    if (own.arms === undefined && own.rig === undefined) throw new Error('Held primary needs its declared sword rig');
    return new Sword(world, targets, { row: profile, profile, allowUnlocked, ...own,
      ...(world.game.level.camera === undefined ? {} : { portraitFov: world.game.level.camera.portraitFov }) });
  }
  if (viewmodel?.arms === undefined || viewmodel.ironArms === undefined) throw new Error('Held melee requires both native arm rigs');
  if (view === 'iron') return new Sword(world, targets, { row: profile, profile, allowUnlocked, blade: 'iron', arms: viewmodel.ironArms });
  const { ironArms: _iron, swim: _swim, ...wood } = viewmodel;
  return new Sword(world, targets, { row: profile, profile, allowUnlocked, ...wood,
    ...(world.game.level.camera === undefined ? {} : { portraitFov: world.game.level.camera.portraitFov }) });
}

/** Client-only held variant. The existing bow and its native actor owner keep
 * their identities; charged activation and contact numbers come from the guest. */
class ChargedBowSlot {
  private bow:Bow|null=null;
  private brain:ReturnProgram|null=null;
  private readonly trail:ProjectedTrail;
  private readonly pending:{t:number;target:TargetAnimal;point:THREE.Vector3;dir:THREE.Vector3;base:number}[]=[];
  private charged=false;
  private reportedFrame=false;
  private readonly origin=new THREE.Vector3();private readonly direction=new THREE.Vector3();private readonly velocity=new THREE.Vector3();private readonly at=new THREE.Vector3();private readonly segment=new THREE.Vector3();
  constructor(scene:THREE.Scene,private readonly camera:THREE.Camera,private readonly rows:BowVariantRows,private readonly check:()=>void){
    this.check();
    this.trail=new ProjectedTrail(scene,camera,this.rows.trail);
  }
  /** Frame readers skip a stale owner; preparation and application still refuse it. */
  private frameReady():boolean{
    try{this.check();return true;}
    catch(error){if(!this.reportedFrame){this.reportedFrame=true;emitFault({system:'held.variant',error,verdict:'retry'});}return false;}
  }
  get applied():boolean{return this.frameReady()&&this.bow!==null;}
  dispose():void{this.pending.length=0;this.trail.dispose();}
  apply(bow:Bow):void{
    this.check();
    const {rows}=this,owner=equipmentActorOwner(bow.targetSource);this.brain??=ReturnProgram.page(rows.program,owner.scope);
    bow.row={...bow.row,id:rows.id,meta:{...bow.meta,name:rows.name}};if(this.bow===bow)return;
    this.bow=bow;bow.setStyle(rows.style);bow.drawSpeedScale*=rows.drawSpeed;bow.onLoose=power=>{this.loosed(power);};
    const previous=bow.damageMultiplier;
    bow.damageMultiplier=hit=>{
      this.check();
      const scales=Object.hasOwn(rows.damageScale.kinds,hit.animal.kind)?rows.damageScale.kinds[hit.animal.kind]:undefined;
      return (previous?.(hit)??1)*(scales??rows.damageScale.base)[this.charged?1:0];
    };
  }
  private decide(power:number,base=0,crush=false):Readonly<Record<string,number>>{
    const rows=this.rows;if(this.brain===null)throw new Error('Variant has no applied native owner');return this.brain.project(rows.signal,{bowPower:power,bowThreshold:rows.threshold,bowBaseDamage:base,bowPierce:rows.pierce,bowCrush:Number(crush),bowCrushScale:rows.crush});
  }
  private loosed(power:number):void{
    this.check();
    const bow=this.bow;this.charged=this.decide(power)['bowSun']===1;if(bow===null||!this.charged)return;
    const {flight}=this.rows,animals=equipmentActorOwner(bow.targetSource).animals,o=this.origin,d=this.direction,velocity=this.velocity,a=this.at,b=this.segment;
    this.camera.getWorldDirection(d);o.setFromMatrixPosition(this.camera.matrixWorld).addScaledVector(d,flight.offset);velocity.copy(d).multiplyScalar(flight.base+flight.draw*power).add(bow.carrierVelocity);
    const n=bow.arrows.predict(o,velocity,this.trail.points,this.rows.trail.points,flight.step,flight.from);this.trail.show(n);
    let first:TargetAnimal|null=null,travelled=0,ax=o.x,ay=o.y,az=o.z;
    for(let i=0;i<48;i++){
      if(i>=n)break;const bx=this.trail.points[i*3]??ax,by=this.trail.points[i*3+1]??ay,bz=this.trail.points[i*3+2]??az;
      a.set(ax,ay,az);b.set(bx-ax,by-ay,bz-az);const length=b.length();
      if(length>1e-3){b.multiplyScalar(1/length);let from=0;
        for(let guard=0;guard<3;guard++){
          const hit=animals.raycast(a.set(ax,ay,az).addScaledVector(b,from),b,length-from);if(hit===null)break;
          if(first===null){first=hit.animal;from+=hit.distance+flight.gap;continue;}
          if(hit.animal!==first&&hit.animal.alive){this.pending.push({t:(travelled+from+hit.distance)/(flight.base+flight.draw*power),target:hit.animal,point:hit.point.clone(),dir:b.clone(),base:hit.damage});return;}
          from+=hit.distance+flight.gap;
        }
      }
      travelled+=length;ax=bx;ay=by;az=bz;
    }
  }
  update(dt:number):void{
    if(!this.frameReady())return;
    this.trail.advance(dt);
    for(let i=this.pending.length-1;i>=0;i--){const hit=this.pending[i];if(hit===undefined)continue;hit.t-=dt;if(hit.t>0)continue;this.pending.splice(i,1);
      if(!hit.target.alive)continue;const result=this.decide(0,hit.base,this.rows.crushKinds.includes(hit.target.kind)),damage=result['bowDamage'];if(damage===undefined)throw new Error('Missing variant contact number');hit.target.applyDamage(damage,hit.point,hit.dir);
    }
  }
}

type PassBlade = InstanceType<BladeSet['Weapon']>;
type SlotPolearm = InstanceType<PolearmSet['Weapon']>;
type SlotBowProfile = ReturnType<typeof bindHeldBow>['profile'];
type BuiltSlot = {kind:'starter';weapon:Sword}|{kind:'blade';weapon:PassBlade;source:BladeSet}
  |{kind:'polearm';weapon:SlotPolearm}|{kind:'bow';weapon:Bow;profile:SlotBowProfile}
  |{kind:'firearm';weapon:HeldFirearm};
/** Current native weapons, selected by admitted slot identities. Upgrades replace
 * the slot's weapon; metadata sources and native save owners remain original. */
export interface HeldSlotKit {
  weapon:(id:string)=>Weapon;
  melee:()=>HeldMeleeOwner;
  blade:(id:string)=>PassBlade;
  polearm:(id:string)=>SlotPolearm;
  bow:(id:string)=>Bow;
  refill:()=>void;
  setMount:(state:PassBlade['mount'])=>void;
  bowPower:(id:string)=>{readonly applied:boolean;update:(dt:number)=>void};
  upgradeBow:(id:string,equipment:EquipmentService)=>void;
  upgradeBlade:(id:string,equipment:EquipmentService,power:ArcWeaponPower)=>void;
}

/** A construction's concrete owner snapshot; published kit methods keep the
 * same scope/product/world fences without pinning the pre-install equipment. */
function heldSlotOwner(ctx:ShardContext,world:HeldPolearmWorld):()=>void {
  const scope=ctx.scope,product=ctx.product,source=product.shardfile,items=source.items;
  const game=ctx.game,runtime=game.runtime,app=ctx.app;
  return ()=>{
    if(scope.disposed||scope.disposing)throw new Error('Held slot owner has ended');
    if(ctx.scope!==scope||ctx.product!==product||product.shardfile!==source||source.items!==items
      ||ctx.game!==game||game.runtime!==runtime||runtime?.world!==world||ctx.app!==app)throw new Error('Held slot owner was replaced');
  };
}

type ToonRows = Extract<HeldArmsRows, { readonly look: unknown }>;
type Claim = ToonRows['claims'][number];
function requireHeldOwner(context: ShardContext, reason: string): void {
  if (context.scope.disposed || context.scope.disposing) throw new Error(reason);
}
const HeldPlaySchema = v.strictObject({ grapple: v.union([
  v.strictObject({ item: v.string(), profile: GrappleProfileSchema, hooks: GrappleHooksSchema, presentation: v.string() }),
  v.strictObject({ item: v.string(), source: v.string(), presentation: v.string() }),
]) });
const PrimaryPresentationSchema = v.object({ portraitFov: v.pipe(v.number(), v.finite(), v.minValue(1), v.maxValue(179)) });
/** A claim's guard evaluates rows over facts; no executable shard guard or notice callback is accepted. */
export class HeldClaimGuard {
  private readonly runner: QuestStepRunner;
  private facts: QuestStepFrame | null = null;
  constructor(private readonly row: Claim['guard']['condition']) { this.runner = new QuestStepRunner({ version: 1, steps: [], guards: [row] }); }
  /** Native fact arrays remain live, so a death changes the prompt before the next interaction read. */
  bindFacts(facts: QuestStepFrame): void { this.facts = facts; }
  reason(): string | null { return this.facts === null ? null : this.runner.guard(this.row.id, this.facts); }
}

const halos = new Map<string, THREE.CanvasTexture>();
function haloTexture(row: Claim['halo']): THREE.CanvasTexture {
  const key = JSON.stringify([row.size, row.stops]), ready = halos.get(key); if (ready !== undefined) return ready;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = row.size;
  const context = canvas.getContext('2d'); if (context === null) throw new Error('Held claim needs a halo canvas');
  const half = row.size / 2, gradient = context.createRadialGradient(half, half, 0, half, half, half);
  for (const [at, opacity] of row.stops) gradient.addColorStop(at, `rgba(255,255,255,${opacity})`);
  context.fillStyle = gradient; context.fillRect(0, 0, row.size, row.size);
  const texture = cacheUntilDisposed(new THREE.CanvasTexture(canvas), () => { halos.delete(key); });
  texture.colorSpace = THREE.SRGBColorSpace; halos.set(key, texture); return texture;
}

/** Internal native pickup; all per-content choices and guard effects come from admitted rows. */
class HeldClaim extends ItemPickup {
  declare readonly interactable: Interactable;
  private readonly guard: HeldClaimGuard;
  private readonly glowLight: THREE.PointLight;
  private readonly halo: THREE.Sprite;
  private readonly haloMat: THREE.SpriteMaterial;
  private readonly glowScene: THREE.Scene;
  private readonly phase: number;
  private flags: readonly string[] | null = null;
  private gone = false;
  constructor(private readonly context: ShardContext, private readonly row: Claim, item: THREE.Object3D, prompt: string) {
    const world = context.game.runtime?.world; if (world === undefined || world === null) throw new Error('Held claim needs its world');
    const random = new Rng(context.product.shardfile.identity.seed ^ row.seedXor), phase = random.next() * row.phase;
    const floor = new THREE.Vector3(...row.position); floor.y += row.lift;
    super({ scene: world.game.scene, item, position: floor, prompt, radius: row.radius, scale: row.scale, tilt: row.tilt, random: () => random.next() });
    this.glowScene = world.game.scene; this.phase = phase; this.guard = new HeldClaimGuard(row.guard.condition);
    const base = this.interactable, reason = (): string | null => this.reason();
    this.interactable = { position: base.position, wireId: row.id,
      get radius() { return reason() === null ? base.radius : Math.min(base.radius, row.guard.radius); },
      get weak() { return reason() !== null; }, get label() { return reason() ?? base.label; },
      onInteract: () => {
        const blocked = reason(); if (blocked === null) { base.onInteract(); return; }
        const play = context.game.runtime?.play; if (play === undefined || play === null) return;
        play.hud.toast(row.guard.toast.replaceAll('{reason}', blocked)); new InteractSfx(play.audio).interact('locked');
      } };
    this.glowLight = LightPool.for(this.glowScene).acquire(row.light.colour, row.light.intensity, row.light.distance, row.light.decay);
    this.glowLight.position.set(floor.x, floor.y + row.light.height, floor.z);
    this.haloMat = new THREE.SpriteMaterial({ map: haloTexture(row.halo), color: row.halo.colour, transparent: true, opacity: row.halo.opacity,
      depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false });
    this.halo = new THREE.Sprite(this.haloMat); this.halo.position.set(floor.x, floor.y + row.halo.height, floor.z);
    this.halo.scale.setScalar(row.halo.scale); this.halo.renderOrder = row.halo.order; this.glowScene.add(this.halo);
  }
  bindGuardFlags(flags: readonly string[]): void { this.flags = flags; }
  private reason(): string | null {
    if (this.flags === null) return null;
    const animals = this.context.game.runtime?.play?.animals.animals;
    this.guard.bindFacts({ flags: this.flags, ...(animals === undefined ? {} : { actors: animals.map(({ kind, alive }) => ({ kind, alive })) }) });
    return this.guard.reason();
  }
  override dispose(): void { super.dispose(); this.removeGlow(); }
  private removeGlow(): void {
    if (this.gone) return; this.gone = true;
    this.glowScene.remove(this.halo); LightPool.for(this.glowScene).release(this.glowLight); this.haloMat.dispose();
  }
  override update(dt: number, time: number): void {
    const world = this.context.game.runtime?.world;
    super.update(dt, time, world?.game.renderer, world?.game.camera);
    if (!this.taken) {
      let flicker = 1; for (const [frequency, amplitude] of this.row.waves) flicker += Math.sin((time + this.phase) * frequency) * amplitude;
      this.glowLight.intensity = this.row.light.intensity * flicker; this.haloMat.opacity = this.row.halo.flickerOpacity * flicker; return;
    }
    if (this.gone) return;
    this.glowLight.intensity = Math.max(0, this.glowLight.intensity - dt * this.row.fade.light);
    this.haloMat.opacity = Math.max(0, this.haloMat.opacity - dt * this.row.fade.opacity); this.halo.scale.addScalar(dt * this.row.fade.scale);
    if (this.haloMat.opacity <= 0) this.removeGlow();
  }
}

type SlotCatalogue=ReturnType<typeof defineSpecimenCatalogue<Record<string,object>>>;
interface SlotMetadata {
  readonly product:ShardProduct;
  readonly source:ShardProduct['shardfile'];
  readonly items:ShardProduct['shardfile']['items'];
  readonly files:readonly {readonly name:string;readonly url:string}[];
  readonly file:string;
  readonly declaration:string;
  readonly readFile:ShardProduct['file'];
  readonly readJson:ShardProduct['json'];
  readonly resolveUrl:ShardProduct['url'];
  catalogue:SlotCatalogue|null;
  readonly bows:Map<string,Promise<ReturnType<typeof bindHeldBow>>>;
  loaded:boolean;
  preparing:boolean;
  ready:{readonly scope:Scope}|null;
  sources:(()=>void)|null;
}
/** Freeze only the newly admitted owned JSON; native metadata remains original. */
function freezeSlotRows(value:unknown):void {
  if(typeof value!=='object'||value===null)return;
  const children:readonly unknown[]=Object.values(value);
  for(const child of children)freezeSlotRows(child);
  Object.freeze(value);
}
const productSlots=new WeakMap<ShardProduct,Map<string,HeldClaims>>();
const catalogues = new Map<string, HeldClaims>();
/** Client-only held melee families, world claims and Explorer cards. The shard supplies rows and platform contexts. */
export class HeldClaims {
  private metadata:SlotMetadata|null=null;
  private readonly originalRows: HeldArmsRows|null;
  private slotRows: HeldSlotsRows|null;
  private readonly blades=new Map<string,BladeSet>();
  private readonly polearms=new Map<string,PolearmSet>();
  private readonly kits=new WeakMap<Scope,{context:ShardContext;kit:HeldSlotKit|null;started:boolean;entered:boolean}>();
  /** Original claim/primary wire; slot owners expose their defining slot rows. */
  get rows():HeldArmsRows {if(this.originalRows===null)throw new Error('Held slots have no claim wire');return this.originalRows;}
  get slots():HeldSlotsRows {if(this.slotRows===null)throw new Error('Held claims have no slot wire');return this.slotRows;}
  private get context():ShardContext {if(this.owner===null)throw new Error('Held slots require their concrete entered context');return this.owner;}
  private readonly arms: HeldView | null;
  private primary: HeldMeleeOwner | null = null;
  private entered = false;
  private portraitFov: number | null = null;
  private readonly geometries = new Map<string, { file: string; source: OwnedGeometry }>();
  private readonly drops = new Map<string, HeldClaim>();
  private constructor(private readonly owner: ShardContext|null,input?:unknown) {
    if(owner===null){
      this.originalRows=null;this.slotRows=parseHeldSlots(input);this.arms=null;
      for(const row of this.slotRows.slots){
        if(row.kind==='blade'&&row.source.kind==='passes')this.blades.set(row.id,new BladeSet({file:row.source.file,item:`weapon.${row.item.slice(7)}`}));
        if(row.kind==='polearm')this.polearms.set(row.id,new PolearmSet({file:row.file,item:`weapon.${row.item.slice(7)}`}));
      }
      return;
    }
    const context=owner;this.slotRows=null;
    this.originalRows = v.parse(HeldArmsSchema, context.product.section('held/arms'));
    this.arms = 'kind' in this.rows ? null : HeldView.admit({ kind: 'toon', ...this.rows.look });
    if ('kind' in this.rows) return;
    for (const claim of this.rows.claims) for (const [id, file] of Object.entries(claim.geometries)) {
      this.geometries.set(`${claim.id}/${id}`, { file, source: createOwnedGeometry(context.product.url(file)) });
    }
  }
  /** Admit finite native construction and control rows without preparing any
   * asset or constructing equipment. Cold metadata never installs a page. */
  static fromSlots(input:unknown):HeldClaims {return new HeldClaims(null,input);}
  /** Product/id-pinned metadata only. Cold admission never prepares native
   * equipment, decodes packed geometry or installs an entered factory. */
  static fromProductSlots(product:ShardProduct,input:unknown,file:string):HeldClaims {
    const rows=parseHeldSlots(input),declaration=JSON.stringify(rows);
    const names=[file,...rows.slots.flatMap(row=>row.kind==='blade'?(row.source.kind==='passes'?[row.source.file]:row.source.framing===undefined?[]:[row.source.framing])
      :row.kind==='tool'?[row.source,row.presentation]:[row.file])];
    if(names.some(name=>!product.hasFile(name)))throw new Error('Missing held source file');
    const files=[...new Set(names)].map(name=>({name,url:product.url(name)}));
    let owners=productSlots.get(product);
    const previous=owners?.get(rows.id);
    if(previous!==undefined){
      const kept=previous.metadata;
      if(kept===null||kept.source!==product.shardfile||kept.file!==file||kept.declaration!==declaration)throw new Error('Held metadata declaration was replaced');
      previous.checkSlotMetadata(kept);return previous;
    }
    const held=HeldClaims.fromSlots(rows);freezeSlotRows(held.slots);
    held.metadata={product,source:product.shardfile,items:product.shardfile.items,files,file,declaration,readFile:product.file,readJson:product.json,resolveUrl:product.url,catalogue:null,bows:new Map(),loaded:false,preparing:false,ready:null,sources:null};
    if(owners===undefined){owners=new Map();productSlots.set(product,owners);}
    owners.set(rows.id,held);return held;
  }
  private checkSlotMetadata(metadata:SlotMetadata):void {
    const product=metadata.product;
    if(product.shardfile!==metadata.source||metadata.source.items!==metadata.items||product.file!==metadata.readFile||product.json!==metadata.readJson||product.url!==metadata.resolveUrl
      ||metadata.files.some(file=>product.url(file.name)!==file.url))throw new Error('Held metadata owner was replaced');
    metadata.sources?.();
  }
  /** Keep the original post-props preparation order. Metadata survives scope
   * retirement; only the current explicit construction readiness is revoked. */
  async prepareSlotSources(ctx:ShardContext):Promise<void> {
    const metadata=this.metadata,world=ctx.game.runtime?.world;
    if(metadata===null||world===undefined||world===null)throw new Error('Held slot preparation needs its pinned product and world');
    if(metadata.preparing)throw new Error('Held slot sources are already preparing');
    const scope=ctx.scope,owner=heldSlotOwner(ctx,world),source=metadata.source,items=metadata.items,equipment=ctx.app.equipment;
    // oxlint-disable-next-line typescript/unbound-method -- Identity snapshots only; calls keep their concrete receiver.
    const blades=[...this.blades].map(([id,value])=>({id,value,prepare:value.prepare,profile:value.profile,Weapon:value.Weapon,Power:value.Power}));
    // oxlint-disable-next-line typescript/unbound-method -- Identity snapshots only; calls keep their concrete receiver.
    const polearms=[...this.polearms].map(([id,value])=>({id,value,prepare:value.prepare,profile:value.profile,Weapon:value.Weapon}));
    const sources=():void=>{
      for(const row of blades)if(this.blades.get(row.id)!==row.value||row.value.prepare!==row.prepare||row.value.profile!==row.profile||row.value.Weapon!==row.Weapon||row.value.Power!==row.Power)throw new Error('Held blade source was replaced');
      for(const row of polearms)if(this.polearms.get(row.id)!==row.value||row.value.prepare!==row.prepare||row.value.profile!==row.profile||row.value.Weapon!==row.Weapon)throw new Error('Held polearm source was replaced');
    };
    const check=():void=>{owner();sources();this.checkSlotMetadata(metadata);if(ctx.product!==metadata.product||ctx.product.shardfile!==source||source.items!==items||ctx.product.file!==metadata.readFile||ctx.product.json!==metadata.readJson||ctx.product.url!==metadata.resolveUrl||ctx.app.equipment!==equipment)throw new Error('Held metadata owner was replaced');};
    check();metadata.preparing=true;
    try {
      // Metadata/book admission survives retirement, but its native pool caches may have been evicted.
      // Rehydrate them before this owner's synchronous weapon factories can borrow their parts.
      for(const row of blades){await row.value.prepare(metadata.product);check();}
      for(const row of polearms){
        const slot=this.slots.slots.find(candidate=>candidate.id===row.id);
        if(slot?.kind!=='polearm')throw new Error('Held polearm source was replaced');
        await (slot.geometry==='on-select'?row.value.prepare(metadata.product,{geometry:'on-select'}):row.value.prepare(metadata.product));
        check();
      }
      if(!metadata.loaded){
        const book=v.parse(SpecimenBookSchema,await metadata.product.json(metadata.file));check();
        const packed=book.packed;if(packed===undefined)throw new Error('Held specimen book has no packed source');
        const files=await prepareSpecimenCatalogue(metadata.product,book.rows,scope,[packed]);check();
        const catalogue=defineSpecimenCatalogue<Record<string,object>>(book.rows,packed,book.materials,files);
        await catalogue.loadPacked();check();
        metadata.catalogue=catalogue;metadata.loaded=true;metadata.sources=sources;
      }
      check();const ready={scope};metadata.ready=ready;
      scope.onDispose(()=>{if(metadata.ready===ready)metadata.ready=null;});
    } finally {metadata.preparing=false;}
  }
  /** Borrow original definitions; never memoize model() results in the kit. */
  model(key:string):ModelDef<object> {
    const metadata=this.metadata,catalogue=metadata?.catalogue;if(metadata===null||catalogue===undefined||catalogue===null)throw new Error('Held specimen source is not prepared');
    this.checkSlotMetadata(metadata);return catalogue.model(key);
  }

  /** Original pool/profile memo belongs to the pinned product metadata, not an
   * entered body. A retired consumer still refuses before native allocation. */
  private loadBow(product:ShardProduct,file:string):Promise<ReturnType<typeof bindHeldBow>> {
    const known=this.metadata?.bows.get(file);if(known!==undefined)return known;
    const read=(async()=>{
      const url=product.url(file),{pool,...definition}=await product.json<HeldBowFileRows>(file);
      if(this.metadata!==null)this.checkSlotMetadata(this.metadata);
      const library=createModelLibrary({meshes:[],meshUrls:{},hd:[],hdUrls:{},aoFloor:1,hdLooks:{},geometryPools:[pool]},`[held bow ${url}]`);
      await library.preload();if(this.metadata!==null)this.checkSlotMetadata(this.metadata);return bindHeldBow(definition,library);
    })();this.metadata?.bows.set(file,read);return read;
  }
  /** Original metadata owners, prepared explicitly at the caller's existing phase. */
  blade(id:string):BladeSet {const owner=this.blades.get(id);if(owner===undefined)throw new Error('Unknown held blade source');return owner;}
  polearm(id:string):PolearmSet {const owner=this.polearms.get(id);if(owner===undefined)throw new Error('Unknown held polearm source');return owner;}
  /** Borrow only the exact kit built by this owner in the original entered scope. */
  pageKit(ctx:Pick<ShardContext,'scope'>):HeldSlotKit|null {return ctx.scope.disposed||ctx.scope.disposing?null:this.kits.get(ctx.scope)?.kit??null;}
  private wireSlots(context:ShardContext):HeldSlotsRows {
    const rows=this.rows;
    if('kind' in rows)return parseHeldSlots({version:1,id:'primary',bindAt:'entered',pause:false,
      slots:[{id:'primary',kind:'blade',item:rows.primary.item,source:{kind:'starter',blade:rows.primary.blade,viewmodel:'declared',framing:rows.primary.file}}],
      registration:['primary'],equipment:{primary:'primary',extras:[]},selection:{unlock:[]},mount:[],refills:[],upgrades:[]});
    const policy=context.product.shardfile.items.loadout.runtime;
    if(policy===undefined)throw new Error('Missing runtime equipment factory policy');
    const ids=new Map(rows.weapons.map((row,index)=>[row.item,`weapon-${index}`]));
    const need=(item:string):string=>{const id=ids.get(item);if(id===undefined)throw new Error('Unresolved runtime equipment factory');return id;};
    const primary=policy.owners.find(row=>row.slot==='primary');if(primary===undefined)throw new Error('Missing native primary');
    const rifle=policy.owners.find(row=>row.slot==='rifle'),secondary=policy.owners.find(row=>row.slot==='secondary');
    return parseHeldSlots({version:1,id:'claims',bindAt:'equipment',pause:policy.pause,
      slots:policy.owners.map(owner=>{const row=rows.weapons.find(entry=>entry.item===owner.item);if(row===undefined)throw new Error('Unresolved runtime equipment factory');
        return {id:need(row.item),kind:'blade',item:row.item,source:{kind:'starter',blade:row.blade,viewmodel:row.blade}};}),
      registration:rows.weapons.map(row=>need(row.item)),equipment:{primary:need(primary.item),extras:policy.owners.filter(row=>row.slot==='extra').map(row=>need(row.item)),
        ...(rifle===undefined?{}:{rifle:need(rifle.item)}),...(secondary===undefined?{}:{secondary:need(secondary.item)})},
      selection:{unlock:[]},mount:[],refills:[],upgrades:[]});
  }
  private starterProfile(context:ShardContext,row:Extract<HeldSlotsRows['slots'][number],{kind:'blade'}>,
    policy:HeldMeleeOwner['profile'],catalogue:ItemCatalogue,portraitFov:number|null):MeleeProfile {
    if(row.source.kind!=='starter')throw new Error('Held starter needs its original native source');
    const blade=row.source.blade==='iron'?SWORD_IRON:SWORD_WOOD;
    const profile:MeleeProfile=row.source.viewmodel==='declared'
      ?Object.assign(applyMeleeCombatProfile(blade,policy),catalogue.equipment(row.item),{parent:SWORD_WOOD.id,feel:{...blade.feel,portraitFov:portraitFov??blade.feel.fovHip}})
      :applyMeleeCombatProfile({...blade,...catalogue.equipment(row.item)},policy);
    const original=this.originalRows,claim=original!==null&&!('kind' in original)?original.claims.find(entry=>entry.item===row.item):undefined;
    if(claim!==undefined)profile.pickup={owned:claim.owned,prompt:claim.prompt,toast:claim.toast,create:(at,prompt)=>{
      if(at!==claim.at)throw new Error('Unknown held claim site');
      const drop=new HeldClaim(context,claim,this.display(claim.id),prompt);this.drops.set(claim.id,drop);return drop;
    }};
    return profile;
  }

  /** Preflight all item/source references before registering the ordered native
   * equipment factory. Construction and registration have independent orders. */
  installPage(ctx:ShardContext):void {
    const rows=this.slots,runtime=ctx.game.runtime,world=runtime?.world;
    if(runtime===undefined||world===undefined||world===null)throw new Error('Held slots need their native world');
    const weaponRows=rows.slots.filter(row=>row.kind!=='tool'),toolRows=rows.slots.filter(row=>row.kind==='tool');
    if(weaponRows.length>16||toolRows.length>1)throw new Error('Held slots exceed their native binding capacity');
    if(rows.bindAt==='entered'&&(weaponRows.length!==1||weaponRows[0]?.kind!=='blade'||weaponRows[0].source.kind!=='starter'))throw new Error('Entered held slots require one starter primary');
    const scope=ctx.scope,owner=heldSlotOwner(ctx,world),equipment=ctx.app.equipment,metadata=this.metadata,ready=metadata?.ready;
    const active=():void=>{owner();if(metadata!==null){if(ctx.product!==metadata.product)throw new Error('Held metadata owner was replaced');this.checkSlotMetadata(metadata);}};
    active();
    if(metadata!==null&&(!metadata.loaded||ready===undefined||ready===null||ready.scope.disposed||ready.scope.disposing||!scope.belongsTo(ready.scope)))throw new Error('Held slot sources are not prepared for this owner');
    if(this.kits.has(scope))throw new Error('Held slots are already installed');
    const catalogue=new ItemCatalogue(ctx.product.shardfile.items),items=ctx.product.shardfile.items;
    const sources=new Map(rows.slots.map(row=>[row.id,row]));
    const policies=new Map<string,HeldMeleeOwner['profile']>(),starterProfiles=new Map<string,MeleeProfile>();
    let primarySword:Sword|null=null,primaryMelee:HeldMeleeOwner|null=null;
    const profiles=rows.registration.map(id=>{
      const row=sources.get(id);if(row===undefined)throw new Error('Missing held registration');
      const item=items.rows.find(entry=>entry.id===row.item);
      if(row.kind==='tool'){
        if(item?.kind!=='tool')throw new Error('Held tool differs from its native item');
      } else {
        if(item?.kind!=='weapon')throw new Error('Held slot differs from its native weapon');
        const family=row.kind==='blade'?'melee':row.kind==='polearm'?'thrown':row.kind;
        if(item.profile?.family!==family)throw new Error('Held slot differs from its native profile');
      }
      if(row.kind==='blade'&&row.source.kind==='passes')this.blade(id).profile();
      if(row.kind==='polearm')this.polearm(id).profile();
      if((row.kind==='firearm'||row.kind==='bow')&&!ctx.product.hasFile(row.file))throw new Error('Missing held ranged file');
      if(row.kind==='tool'&&(!ctx.product.hasFile(row.source)||!ctx.product.hasFile(row.presentation)))throw new Error('Missing held tool file');
      if(row.kind==='blade'&&row.source.kind==='starter'&&row.source.framing!==undefined&&!ctx.product.hasFile(row.source.framing))throw new Error('Missing held primary framing');
      if(row.kind==='blade'&&row.source.kind==='starter'){
        const policy=v.parse(MeleeWeaponProfileSchema,item.kind==='weapon'?item.profile:undefined);policies.set(row.id,policy);
        const profile=this.starterProfile(ctx,row,policy,catalogue,this.portraitFov);starterProfiles.set(row.id,profile);
        if(row.id===rows.equipment.primary)primaryMelee={profile:policy,primary:()=>{if(primarySword===null)throw new Error('Held primary is not built before play');return primarySword;}};
        return {row,profile};
      }
      return {row,profile:catalogue.equipment(row.item)};
    });
    const tools=this.originalRows!==null&&'kind' in this.originalRows?this.originalRows.tools.map(id=>{
      if(!items.rows.some(row=>row.id===id&&row.kind==='tool'))throw new Error(`Missing declared tool: ${id}`);return catalogue.equipment(id);
    }):[];
    const check=():void=>{active();if(ctx.app.equipment!==equipment)throw new Error('Held slot equipment was replaced');if(metadata!==null){if(metadata.ready!==ready)throw new Error('Held construction readiness was replaced');const prepared=metadata.ready;if(prepared===null||prepared.scope.disposed||prepared.scope.disposing)throw new Error('Held construction readiness was replaced');}};
    check();
    if(this.originalRows!==null&&'kind' in this.originalRows){const first=profiles[0];if(first===undefined)throw new Error('Missing held primary factory');ctx.rows.weapon(first.profile);}
    else if(profiles.every(entry=>entry.row.kind!=='tool'))ctx.rows.weapon(profiles.map(entry=>entry.profile));
    else for(const {row,profile} of profiles){if(row.kind==='tool')ctx.rows.tool(profile);else ctx.rows.weapon(profile);}
    for(const tool of tools)ctx.rows.tool(tool);
    if(this.originalRows!==null&&'kind' in this.originalRows)this.primary=primaryMelee;
    const record:{context:ShardContext;kit:HeldSlotKit|null;started:boolean;entered:boolean}={context:ctx,kit:null,started:false,entered:false};
    this.kits.set(scope,record);scope.onDispose(()=>{this.kits.delete(scope);});
    runtime.buildEquipment=async(targets,allowUnlocked,viewmodel)=>{
      check();if(record.started)throw new Error('Held slot construction has already started');record.started=true;
      const built=new Map<string,BuiltSlot>(),bowPowers=new Map<string,ChargedBowSlot>();
      for(const [index,row] of rows.slots.entries()){
        if(row.kind==='tool')continue;
        if(row.kind==='blade'){
          if(row.source.kind==='passes'){
            const source=this.blade(row.id);built.set(row.id,{kind:'blade',source,weapon:new source.Weapon(world,targets,{allowUnlocked})});
          } else {
            const policy=policies.get(row.id);let profile=starterProfiles.get(row.id);
            if(policy===undefined||profile===undefined)throw new Error('Missing held starter profile');
            if(row.source.framing!==undefined&&this.portraitFov===null){const data=await ctx.product.json(row.source.framing);check();profile=this.starterProfile(ctx,row,policy,catalogue,v.parse(PrimaryPresentationSchema,data).portraitFov);}
            const weapon=heldSword(world,targets,allowUnlocked,viewmodel,profile,row.source.viewmodel);
            built.set(row.id,{kind:'starter',weapon});
            if(row.id===rows.equipment.primary)primarySword=weapon;
          }
        } else if(row.kind==='polearm')built.set(row.id,{kind:'polearm',weapon:new (this.polearm(row.id).Weapon)(world,targets,{allowUnlocked,owner:scope})});
        else if(row.kind==='bow'){
          const {profile}=await this.loadBow(ctx.product,row.file);check();
          built.set(row.id,{kind:'bow',profile,weapon:new Bow(world,targets,{row:catalogue.equipment(row.item),profile,allowUnlocked})});
        } else {
          const data=await ctx.product.json<{feel:Pick<HeldFirearmProfile,'ads'>;view:HeldFirearmView;rows:HeldFirearmRows}>(row.file);check();
          const item=items.rows.find(entry=>entry.id===row.item);
          const profile={...v.parse(FirearmWeaponProfileSchema,item?.kind==='weapon'?item.profile:undefined),...data.feel};
          built.set(row.id,{kind:'firearm',weapon:new HeldFirearm(world,targets,{row:catalogue.equipment(row.item),allowUnlocked,muzzleLight:row.muzzleLight,profile,view:data.view,rows:data.rows,model:{}})});
        }
        if(rows.pause&&index+1<rows.slots.length){await macrotask();check();}
      }
      check();
      // Required first views retain the original pre-control readiness. Other
      // explicitly deferred pools are prepared by the selection gate below.
      for(const id of new Set([rows.equipment.primary,...rows.selection.initial===undefined?[]:[rows.selection.initial]])){
        const slot=built.get(id);
        if(slot?.kind==='polearm'&&rows.slots.some(row=>row.id===id&&row.kind==='polearm'&&row.geometry==='on-select')&&slot.weapon.needsPreparation){await slot.weapon.prepareView();check();}
      }
      const need=(id:string):BuiltSlot=>{const slot=built.get(id);if(slot===undefined)throw new Error('Held slot has no built weapon');return slot;};
      const kit:HeldSlotKit={
        weapon:id=>{active();return need(id).weapon;},
        melee:()=>{active();if(primaryMelee===null)throw new Error('Held slot primary is not a starter sword');return primaryMelee;},
        blade:id=>{active();const slot=need(id);if(slot.kind!=='blade')throw new Error('Held slot is not a pass blade');return slot.weapon;},
        bow:id=>{active();const slot=need(id);if(slot.kind!=='bow')throw new Error('Held slot is not a bow');return slot.weapon;},
        polearm:id=>{active();const slot=need(id);if(slot.kind!=='polearm')throw new Error('Held slot is not a polearm');return slot.weapon;},
        setMount:state=>{active();for(const id of rows.mount){const slot=need(id);if(slot.kind==='bow')slot.weapon.setMount(state);else if(slot.kind==='blade'||slot.kind==='polearm')slot.weapon.mount=state;else throw new Error('Invalid held mount owner');}},
        refill:()=>{active();for(const row of rows.refills){const slot=need(row.slot);if(slot.kind==='bow'&&row.kind==='add-magazine')slot.weapon.addBolts(slot.weapon.magazine);else if(slot.kind==='polearm'&&row.kind==='fill-capacity')slot.weapon.javelins=slot.weapon.maxJavelins;else throw new Error('Invalid held refill owner');}},
        bowPower:id=>{
          active();const row=rows.upgrades.find(entry=>entry.id===id);
          if(row?.kind!=='bow'||row.power===undefined)throw new Error('Unknown held bow power');
          let power=bowPowers.get(id);
          if(power===undefined){const created=new ChargedBowSlot(world.game.scene,world.game.camera,row.power.rows,active);power=created;bowPowers.set(id,created);scope.onDispose(()=>{created.dispose();});}
          return power;
        },
        upgradeBow:(id,weapons)=>{
          active();const row=rows.upgrades.find(entry=>entry.id===id),slot=row===undefined?undefined:need(row.slot);
          if(row?.kind!=='bow'||slot?.kind!=='bow')throw new Error('Unknown held bow upgrade');
          const power=bowPowers.get(id);if(power===undefined)throw new Error('Held bow power is not prepared');
          const previous=slot.weapon;if(previous.row.id===row.replacement.item)return;
          if(weapons.get(previous.id)!==previous)throw new Error('Held upgrade requires its original equipment');
          const next=new Bow(world,targets,{row:{...previous.row,id:`weapon.${row.replacement.item.slice(7)}`,ui:{...previous.row.ui,name:row.replacement.name,swapName:row.replacement.name},meta:{...previous.meta,name:row.replacement.name}},profile:slot.profile,allowUnlocked});
          next.damageMultiplier=previous.damageMultiplier;next.onLoose=previous.onLoose;next.carryMountState(previous);
          weapons.replace(previous.id,next);slot.weapon=next;power.apply(next);
        },
        upgradeBlade:(id,weapons,power)=>{
          active();const row=rows.upgrades.find(entry=>entry.id===id),slot=row===undefined?undefined:need(row.slot);
          if(row?.kind!=='blade-pass'||slot?.kind!=='blade')throw new Error('Unknown held blade upgrade');
          const previous=slot.weapon;if(previous.row.id===row.replacement.item)return;
          if(weapons.get(previous.id)!==previous)throw new Error('Held upgrade requires its original equipment');
          const base=slot.source.profile(),next=new slot.source.Weapon(world,targets,{allowUnlocked,power,profile:{...base,id:`weapon.${row.replacement.item.slice(7)}`,parent:base.id,ui:{...base.ui,name:row.replacement.name},meta:{...base.meta,name:row.replacement.name}}});
          next.carryPassState(previous);weapons.replace(previous.id,next);slot.weapon=next;
        },
      };
      if(rows.bindAt==='equipment'){const bound=bindRuntimeEquipment(ctx,ctx.product.shardfile,rows.registration.flatMap(id=>{
        const slot=built.get(id),row=sources.get(id);if(slot===undefined||row===undefined)return [];
        const weapon=slot.weapon,source=items.rows.find(entry=>entry.id===row.item);
        const presentation=items.loadout.runtime?.owners.find(entry=>entry.item===row.item)?.presentation;
        return [{id:row.item,weapon,profile:source?.kind==='weapon'?source.profile:undefined,...(presentation===undefined?{}:{presentation})}];
      }));
        if(this.originalRows!==null&&!('kind' in this.originalRows)&&bound.primary!==need(rows.equipment.primary).weapon)throw new Error('Runtime equipment requires its declared primary first');
      }
      check();record.kit=kit;
      const equipmentRows=rows.equipment;
      const deferred=rows.slots.flatMap(row=>{if(row.kind!=='polearm'||row.geometry!=='on-select')return [];const slot=need(row.id);return slot.kind==='polearm'&&slot.weapon.needsPreparation?[slot]:[];});
      return {primary:need(equipmentRows.primary).weapon,rifle:equipmentRows.rifle===undefined?null:need(equipmentRows.rifle).weapon,
        secondary:equipmentRows.secondary===undefined?null:need(equipmentRows.secondary).weapon,
        ...(equipmentRows.extras.length===0&&this.originalRows!==null&&'kind' in this.originalRows?{}:{extras:equipmentRows.extras.map(id=>need(id).weapon)}),
        ...(equipmentRows.order===undefined?{}:{order:equipmentRows.order.map(id=>need(id).weapon.id)}),
        ...(rows.selection.unlock.length===0&&rows.selection.initial===undefined&&deferred.length===0?{}:{install:(weapons:EquipmentService)=>{
          active();
          for(const slot of deferred)if(slot.kind==='polearm'){
            const weapon=slot.weapon;
            // oxlint-disable-next-line typescript/unbound-method -- Snapshot only; invocation retains its original receiver.
            const prepare=weapon.prepareView;
            const selected=():void=>{active();if(metadata!==null&&metadata.ready!==ready||weapon.prepareView!==prepare)throw new Error('Held selection preparation was replaced');};
            weapons.prepareOnSelect(weapon.id,async()=>{selected();await prepare.call(weapon);selected();});
          }
          for(const id of rows.selection.unlock)weapons.unlock(need(id).weapon.id);
          if(rows.selection.initial!==undefined)weapons.select(need(rows.selection.initial).weapon.id,true);
        }})};
    };
  }

  /** Prepare explicitly during kit installation; publication and retirement follow the context scope. */
  static async prepare(context: ShardContext): Promise<HeldClaims> {
    if (context.scope.disposed || context.scope.disposing) throw new Error('Held preparation scope has ended');
    const scope = context.scope, product = context.product, sourceOwner = product.shardfile;
    const game = context.game, runtime = game.runtime, world = runtime?.world;
    const check = (): void => {
      if (context.scope !== scope || context.product !== product || product.shardfile !== sourceOwner
        || context.game !== game || game.runtime !== runtime || runtime?.world !== world) throw new Error('Held owner replaced during preparation');
      requireHeldOwner(context, 'Held claim entry owner ended during preparation');
    };
    const host = new HeldClaims(context);
    if ('kind' in host.rows) {
      const presentation = await product.json(host.rows.primary.file);check();
      host.portraitFov = v.parse(PrimaryPresentationSchema, presentation).portraitFov;
    } else {
      if (host.arms === null) throw new Error('Held claims require their original arms');
      await Promise.all([host.arms.prepare(context).then(check), Promise.all([...host.geometries.values()].map(async ({ file, source }) => {
        const bytes = await product.file(file);check();
        await source.load(bytes);check();
      }))]);
    }
    check();
    catalogues.set(product.slug, host);
    scope.onDispose(() => {
      if (catalogues.get(product.slug) === host) catalogues.delete(product.slug);
      host.drops.clear(); for (const { source } of host.geometries.values()) source.take().dispose();
    });
    return host;
  }
  static current(slug: string): HeldClaims { const host = catalogues.get(slug); if (host === undefined) throw new Error('Held claims are not prepared'); return host; }
  /** Look up a claim for plain quest facts. Taking, ownership and persistence remain on EquipmentService. */
  claim(id: string): HeldClaim | null { return this.drops.get(id) ?? null; }
  /** Owned copies of the row's original geometry and shared graph materials, used by pickup and parity fixtures. */
  display(id: string): THREE.Group {
    const rows = this.rows, arms = this.arms;
    if ('kind' in rows || arms === null) throw new Error('Declared primary has no Toon claim display');
    const row = rows.claims.find(claim => claim.id === id); if (row === undefined) throw new Error('Unknown held claim');
    const geometry = new Map(Object.keys(row.geometries).map(name => {
      const part = this.geometries.get(`${row.id}/${name}`)?.source.copy(); if (part === undefined) throw new Error('Held claim geometry is not prepared'); return [name, part] as const;
    }));
    const materials = new Map(Object.entries(row.materials).map(([name, material]) => [name, arms.materialById(material)]));
    const made = createClientScene(row.scene, { geometry, materials }), group = made.group(row.group);
    if (group === null) throw new Error('Held claim needs its declared group'); return group;
  }
  /** The original primary owner, available only after its declared kit install. */
  melee(context?:ShardContext): HeldMeleeOwner {
    if(this.originalRows===null){if(context===undefined)throw new Error('Held slot melee needs its entered context');const kit=this.pageKit(context);if(kit===null)throw new Error('Held slot primary is not installed');return kit.melee();}
    if (this.context.scope.disposed || this.context.scope.disposing) throw new Error('Held primary owner has ended');
    if (this.primary === null) throw new Error('Declared primary is not installed');
    return this.primary;
  }
  private requireUnentered(context:ShardContext): void {
    if(this.slotRows!==null){const record=this.kits.get(context.scope);if(record===undefined||record.entered)throw new Error('Held play is already installed or missing');}
    else if(this.entered)throw new Error('Held play is already installed');
  }
  /** Bind the already-built declared primary and one declared grapple tool at entered play. */
  async enter(context: ShardContext, input: unknown): Promise<void> {
    if (!isJsonData(input)) throw new Error('Held play input must be JSON data');
    requireHeldOwner(context, 'Held play owner has ended');
    const scope = context.scope, product = context.product, app = context.app;
    const slotRecord=this.slotRows===null?null:this.kits.get(scope);
    if(slotRecord===null){if(scope!==this.context.scope||product!==this.context.product)throw new Error('Held play requires its original entered owner');}
    else if(slotRecord===undefined||product!==slotRecord.context.product||context.game!==slotRecord.context.game||app!==slotRecord.context.app)throw new Error('Held play requires its original entered owner');
    const primarySlot=this.slotRows?.slots.find(row=>row.id===this.slotRows?.equipment.primary);
    let rows:{primary:{item:string};tools:readonly string[]};
    const original=this.originalRows;
    if(original!==null){
      if(!('kind' in original))throw new Error('Held play requires a declared primary');
      rows=original;
    } else {
      if(primarySlot===undefined)throw new Error('Held play requires a declared primary');
      rows={primary:{item:primarySlot.item},tools:this.slots.slots.filter(row=>row.kind==='tool').map(row=>row.item)};
    }
    if(this.originalRows===null&&this.slotRows!==null&&(this.slotRows.bindAt!=='entered'||primarySlot?.kind!=='blade'||primarySlot.source.kind!=='starter'))throw new Error('Held play requires its declared starter primary');
    this.requireUnentered(context);
    const { grapple: spec } = v.parse(HeldPlaySchema, input), source = product.shardfile, items = source.items;
    if(this.originalRows===null&&this.slotRows!==null){const tool=this.slotRows.slots.find(row=>row.kind==='tool'&&row.item===spec.item);if(tool?.kind!=='tool'||!('source' in spec)||tool.source!==spec.source||tool.presentation!==spec.presentation)throw new Error('Held play differs from its admitted tool');}
    if (rows.tools.length !== 1 || rows.tools[0] !== spec.item) throw new Error('Held play requires its one declared grapple');
    const declaration = items.rows.find(row => row.id === spec.item), weapon = items.rows.find(row => row.id === rows.primary.item);
    if (declaration?.kind !== 'tool' || weapon?.kind !== 'weapon') throw new Error('Held play requires its declared primary and tool');
    if (items.rows.some(row => row.id !== weapon.id && row.id !== declaration.id)) throw new Error('Held play cannot bind an undeclared equipment family');
    if (![...('source' in spec ? [spec.source] : []), spec.presentation].every(file => product.hasFile(file))) throw new Error('Held play requires its admitted grapple files');
    const equipment = app.equipment;
    if (equipment === null) throw new Error('Held play requires its loadout');
    const melee = this.melee(context), { primary: built, profile } = melee, primary = built();
    if (primary.row.id !== rows.primary.item || !sameRuntimeProfile(weapon.profile, profile)) throw new Error('Held play primary differs from its original item');
    const equipmentRow = new ItemCatalogue(items).equipment(spec.item);
    const [content, presentation] = await Promise.all([
      'source' in spec ? product.json<{ readonly hooks: unknown; readonly grappleProfile: unknown }>(spec.source)
        : Promise.resolve({ hooks: spec.hooks, grappleProfile: spec.profile }),
      product.json<GrappleRows>(spec.presentation),
    ]);
    const hooks = v.parse(GrappleHooksSchema, content.hooks), grappleProfile = parseGrappleProfile(content.grappleProfile);
    if (grappleProfile.id !== spec.item) throw new Error('Held play grapple profile and item differ');
    if (context.scope !== scope || scope.disposed || scope.disposing) throw new Error('Held play owner ended during preparation');
    if (context.product !== product || product.shardfile !== source || context.app !== app || app.equipment !== equipment) throw new Error('Held play owner was replaced during preparation');
    const current = this.melee(context);
    if (current !== melee || current.primary() !== primary || current.profile !== profile || !sameRuntimeProfile(weapon.profile, profile)) throw new Error('Held play primary was replaced during preparation');
    this.requireUnentered(context);
    const grapple = new GrappleTool(context, { equipment: equipmentRow, profile: grappleProfile, presentation, hooks }), tool = grapple.row;
    grappleGuard(scope).bind(grapple);
    if(slotRecord===null)this.entered=true;else slotRecord.entered=true;
    bindRuntimeEquipment(context, { ...source, items: { ...items, rows: items.rows.filter(row => row.kind === 'weapon'), loadout: { ...items.loadout, tools: [] } } },
      [{ id: primary.row.id, weapon: primary, profile }]);
    bindRuntimeItems(context, source, {
      kit: new Map([[weapon.family, { kind: 'weapon', profiles: ['melee'], create: () => primary }]]),
      families: new Map([[declaration.family, { kind: 'tool', presentation: { ui: tool.ui }, create: row => { grapple.row = { ...row, meta: tool.meta }; return grapple; } }]]),
      icon: name => { const row = [primary.row, tool].find(entry => entry.ui.icon === name); if (row === undefined) throw new Error(`Unknown held item icon ${name}`); return row.ui.icon; },
    });
    equipment.add(grapple, { locked: false });
  }

  /** Normalize the retained held wire once, then use the finite native slot
   * factory. Existing cards, claims, source rows and entered API stay original. */
  install(context?:ShardContext,id?:string):void {
    if(this.originalRows===null){
      if(context===undefined||id!==this.slots.id||this.metadata===null||this.metadata.product!==context.product)throw new Error('Held installation requires its pinned product and declared id');
      this.installPage(context);return;
    }
    if(context!==undefined&&(context.scope!==this.context.scope||context.product!==this.context.product))throw new Error('Held installation requires its original entered owner');
    this.slotRows??=this.wireSlots(this.context);
    this.installPage(this.context);
  }
  /** Define cold cards from admitted rows; loading and dressing remain inside this host. */
  static gear(input: unknown): readonly RosterEntry[] {
    return heldArmsGear(input);
  }
}
