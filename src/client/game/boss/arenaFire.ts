/** Client-only instanced arena flames, smoke and whirlwinds. No fight decisions or hazard ownership. */
import * as THREE from 'three';
import { TIER } from '@wildshard/engine/core/tier';
import { lentLook, setLentParam } from '../shardfile/lentLooks';
import type { ReturnProgram } from '../../../shared/game/population/returnProgram';
import { ArenaWhirls, type ArenaWhirlsSnapshot, type WhirlFrame } from '../../../shared/game/boss/arenaWhirls';
import type {Scope} from '@wildshard/engine/app/scope';
import {presentEntryOwner,publishEntryOwner} from '../../../shared/game/shardfile/entryOwners';
import {preflightViewLends,lendViewArray,lendViewCell,lendViewValues,lendViewDraw,lendViewFrame,lendViewTell} from '../shardfile/clientViewProgram';
import type { ArenaWhirlsRows,ArenaFireRows } from '@wildshard/format/encounterRows';
import { ARENA_VIEW, arenaChainTell } from '@wildshard/format/arenaView';
import type { OpenArenaFight } from '../../../shared/game/boss/openArenaFight';

const POSE_CELLS = ['bend', 'raise', 'castL', 'struck', 'alpha'] as const;
/** The open arena's view half: lend its view module (format/arenaView) what it samples and writes, then the frame slot it
 *  runs at, for `scope`'s life. The fight below stays numbers and rules. */
export function lendOpenArenaView(fight: OpenArenaFight, scope: Scope): void {
  const { sources, cells: ids, tells } = ARENA_VIEW, { arena, chains, field, fire, scorch, whirls, phone, smoke, wind, burnt, groundAt, fireOn, fireClear, bindFire } = fight.viewLoan;
  for (const source of [sources.life, sources.clocks, sources.pose, sources.spear]) lendViewValues(scope, source, fight.viewSource(source));
  const cells = fight.poseCells();
  for (const key of POSE_CELLS) lendViewCell(scope, ids[key], cells[key]);
  lendViewTell(scope, tells.spear, arena.tell('spear')); lendViewTell(scope, tells.fork, arena.tell('fork'));
  for (const [i, tell] of chains.entries()) lendViewTell(scope, arenaChainTell(i), tell);
  const view = { frame: lendViewFrame(scope, ARENA_VIEW.slot).frame, cells };
  // the grass fire: its field (modes, lifetimes, the ground under each cell, this frame's burnt-out cells), its values
  // and its draws, at the fire's own slot
  const lent = ARENA_VIEW.fire, ground = new Float32Array(field.length);
  for (let c = 0; c < field.length; c++) ground[c] = groundAt(field.x(c), field.z(c));
  const smokeRate = smoke === undefined ? 0 : phone ? smoke[0] : smoke[1];
  const values: Readonly<Record<string, () => number>> = { on: () => Number(fireOn()), clear: () => Number(fireClear()), windX: () => wind.dirX,
    windZ: () => wind.dirZ, windSpeed: () => wind.speed, smokeCap: () => fire.smoke.instanceMatrix.count, smokeRate: () => smokeRate,
    scorchCap: () => scorch.instanceMatrix.count };
  lendViewValues(scope, lent.values, name => values[name]?.() ?? Number.NaN);
  lendViewArray(scope, lent.arrays.modes, () => field.modeCells); lendViewArray(scope, lent.arrays.lifetimes, () => field.lifetimeCells);
  lendViewArray(scope, lent.arrays.ground, () => ground); lendViewArray(scope, lent.arrays.burnt, () => burnt);
  lendViewDraw(scope, lent.draws.flames, fire.flames); lendViewDraw(scope, lent.draws.smoke, fire.smoke); lendViewDraw(scope, lent.draws.scorch, scorch);
  bindFire(scope, lendViewFrame(scope, lent.slot).frame);
  whirls.bindView(scope);
  fight.adoptView(scope, view);
}

/** The phase-3 fire's instanced flames and smoke (each copy's aInst: the flames' heat, front and seed, the smoke's age,
 *  glow and seed) and their looks. The fight's fire view module draws them (Nalati zero R6: behaviour/titanFireView). */
export class ArenaFireView {
  readonly flames: THREE.InstancedMesh;
  readonly smoke: THREE.InstancedMesh;
  private readonly wind = new THREE.Vector2();

  readonly rows: ArenaFireRows;
  constructor(scene: THREE.Scene, input: ArenaFireRows, flames: unknown) {
    const rows = input;
    if (rows.life[0] <= 0 || rows.life[1] < 0) throw new Error('Invalid smoke lifetime');
    this.rows = rows;
    const flameGeo = new THREE.BufferGeometryLoader().parse(flames);
    flameGeo.setAttribute('aInst', new THREE.InstancedBufferAttribute(new Float32Array(rows.flameCount * 3), 3));
    this.flames = new THREE.InstancedMesh(flameGeo, lentLook(rows.flameLook), rows.flameCount);
    this.flames.frustumCulled = false; this.flames.count = 0; this.flames.renderOrder = 14; this.flames.name = rows.flameLook;
    scene.add(this.flames);
    const nSmoke = TIER === 'phone' ? rows.smokeCount[0] : rows.smokeCount[1];
    const smokeGeo = new THREE.IcosahedronGeometry(1, TIER === 'phone' ? rows.smokeDetail[0] : rows.smokeDetail[1]);
    smokeGeo.setAttribute('aInst', new THREE.InstancedBufferAttribute(new Float32Array(nSmoke * 3), 3));
    this.smoke = new THREE.InstancedMesh(smokeGeo, lentLook(rows.smokeLook), nSmoke);
    this.smoke.frustumCulled = false; this.smoke.count = 0; this.smoke.name = rows.smokeLook;
    scene.add(this.smoke);
  }

  /** the looks' clock, wind, fog colour and flash, once a frame */
  update(t: number, windX: number, windZ: number, windSpeed: number, fog: THREE.Color, flash: number): void {
    this.wind.set(windX, windZ).multiplyScalar(Math.min(0.5, 0.12 + 0.025 * windSpeed));
    setLentParam(this.rows.flameLook, 't', t); setLentParam(this.rows.flameLook, 'wind', [this.wind.x, this.wind.y]);
    setLentParam(this.rows.smokeLook, 't', t); setLentParam(this.rows.smokeLook, 'fogC', [fog.r, fog.g, fog.b]); setLentParam(this.rows.smokeLook, 'flash', flash);
  }
}

/** Whirlwinds: their laws and gate are ArenaWhirls (arenaWhirls.ts, renderer-free); this view holds the caller's funnel
 *  meshes (one per law) and debris (its instanced mesh), shows each funnel above .02 of its ease, and lends them to the
 *  fight's whirl view module, which draws their turn, breathe and sink and the debris spiral (Nalati zero R6:
 *  behaviour/titanWhirlsView) from what `drawn` holds after each update. */
export class ArenaWhirlsView {
  private readonly rows: ArenaWhirlsRows;
  private viewFrame:ReturnType<typeof lendViewFrame>|null=null;
  private readonly hits: THREE.Vector3[] = [];
  /** the laws and gate the funnels follow */
  readonly whirls: ArenaWhirls;
  /** per whirlwind after the last update: its ease, whether it shows, and where it stands (x, the ground, z) */
  get drawn(): ArenaWhirls['drawn'] { return this.whirls.drawn; }
  /** the funnels and the debris, for the view module the fight lends them to */
  readonly funnels: readonly THREE.Object3D[];
  constructor(input: ArenaWhirlsRows, program: ReturnProgram, funnels: readonly THREE.Object3D[], readonly debris: THREE.InstancedMesh, gateProgram: ReturnProgram,private readonly nativeScope:Scope) {
    this.live();ArenaWhirlsView.preflight(input);
    if (funnels.length !== input.laws.length || debris.instanceMatrix.count < input.laws.length * input.debris.count) throw new Error('Whirlwinds need a funnel each and room for their debris');
    this.rows = input; this.funnels = funnels;
    this.whirls = new ArenaWhirls(input, program, gateProgram, nativeScope);
  }
  private live():void{if(this.nativeScope.disposed||this.nativeScope.disposing)throw new Error('Whirlwind native owner has ended');}
  /** CI12: the whirlwinds' continuation (the funnels and debris are drawn from it again) */
  snapshot():ArenaWhirlsSnapshot{return this.whirls.snapshot();}
  restore(saved:ArenaWhirlsSnapshot):void{this.whirls.restore(saved);}
  /** Admit all gate references before the caller allocates native resources. */
  static preflight(rows:ArenaWhirlsRows,program?:ReturnType<typeof ReturnProgram.projectionBindings>):void{ ArenaWhirls.preflight(rows,program); }
  /** Lend only this owner's concrete resources on the entered view scope.
   * Names/field aliases and the inline frame slot are admitted rows. */
  bindView(scope:Scope):void{
    this.live();if(!scope.belongsTo(this.nativeScope))throw new Error('Whirlwind view requires its construction ancestor');
    const rows=this.rows.view;
    preflightViewLends(scope,{values:[rows.source],draws:[rows.draw],frames:[rows.slot]});
    if(this.viewFrame!==null||rows.slots.some(slot=>presentEntryOwner(scope,'object',slot.object)!==null))throw new Error('Whirlwind view already bound');
    const fields=new Map<string,{row:ArenaWhirls['drawn'][number];key:keyof ArenaWhirls['drawn'][number]}>();
    const objects=rows.slots.map((slot,i)=>{
      const row=this.drawn[i],object=this.funnels[i];if(row===undefined||object===undefined)throw new Error('Missing whirlwind view resource');
      for(const key of ['k','shown','x','y','z'] as const)fields.set(slot.fields[key],{row,key});return {id:slot.object,object};
    });
    lendViewValues(scope,rows.source,name=>{const field=fields.get(name);return field===undefined?Number.NaN:field.row[field.key];});
    for(const {id,object}of objects)publishEntryOwner(scope,'object',id,object);
    lendViewDraw(scope,rows.draw,this.debris);
    const frame=this.viewFrame=lendViewFrame(scope,rows.slot);scope.onDispose(()=>{if(this.viewFrame===frame)this.viewFrame=null;});
  }
  /** Which whirlwinds blow (bit i: whirlwind i), at the original arm slot. */
  arm(mask: number): void { this.whirls.arm(mask); }
  reset(): void { this.whirls.reset(); for (const funnel of this.funnels) funnel.visible = false; this.debris.count = 0; }
  /** The laws' update (ArenaWhirls.update), each funnel shown as its whirlwind is, then the view module's frame. The
   *  whirlwinds that touch the player this tick, where they stand. */
  update(dt: number, t: number, live: boolean, thinkDt: number, frame: WhirlFrame): readonly THREE.Vector3[] {
    const hits = this.whirls.update(dt, t, live, thinkDt, frame);
    for (let i = 0; i < this.funnels.length; i++) { const funnel = this.funnels[i]; if (funnel !== undefined) funnel.visible = this.drawn[i]?.shown === 1; }
    for (let i = 0; i < hits.length; i++) { const hit = hits[i]; if (hit !== undefined) this.hits[i] = (this.hits[i] ?? new THREE.Vector3()).set(hit.x, hit.y, hit.z); }
    this.hits.length = hits.length;this.live();this.viewFrame?.frame(dt,t);
    return this.hits;
  }
  /** A page that steps no whirlwinds: each funnel shown as `drawn` was heard, then the view module's frame. */
  drawHeard(dt: number, t: number): void {
    for (let i = 0; i < this.funnels.length; i++) { const funnel = this.funnels[i]; if (funnel !== undefined) funnel.visible = this.drawn[i]?.shown === 1; }
    this.live();this.viewFrame?.frame(dt,t);
  }
}
