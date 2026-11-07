import { clientNativeBook } from '../shardfile/clientNativeBook';
import { Vector3 } from 'three';
import { parse } from 'valibot';
import type { Game } from '@wildshard/engine/core/Game';
import type { Scope } from '@wildshard/engine/app/scope';
import type { CombatCues } from '@wildshard/engine/combat/cues';
import { Impacts } from '@wildshard/engine/fx/Impacts';
import { effectField, type EffectField } from '@wildshard/engine/fx/effectField';
import { ParticlePool, pointScale } from '@wildshard/engine/fx/ParticlePool';
import { terrainHeight as heightAt } from '@wildshard/engine/world/terrainHeight';
import { CueDirectorSchema, type CueDirectorRows } from '@wildshard/format/cueDirector';
import type { ShardContext } from '../plugin/context';
import { sceneModelSource } from '../shardfile/sceneSources';
import { lentLook, setLentParam } from '../shardfile/lentLooks';

type SprayRow = NonNullable<CueDirectorRows['sprays']>[number];
type SprayTarget = Extract<CueDirectorRows['rows'][number]['vfx'][number], { kind: 'spray' }>;
const GRAVITY = 1, BOUNCE = 2, GROW = 4, RISE = 8, FLAG = { gravity: GRAVITY, bounce: BOUNCE, grow: GROW, rise: RISE } as const;

/** One declared spray: a pooled point draw in its lent look whose points fall, bounce on the terrain, grow and rise by their flags. */
class CueSpray {
  private readonly pool: ParticlePool<'aSize' | 'aAlpha' | 'aColor'>;
  private readonly maxLife: Float32Array; private readonly size0: Float32Array; private readonly flags: Uint8Array;
  private live = 0;
  constructor(private readonly row: SprayRow, scope: Scope) {
    this.pool = new ParticlePool({ capacity: row.capacity, material: lentLook(row.look), renderOrder: row.renderOrder,
      attributes: { aSize: { itemSize: 1, dynamic: true }, aAlpha: { itemSize: 1, dynamic: true }, aColor: { itemSize: 3, dynamic: true } } });
    this.pool.points.name = `cue-${row.id}`; scope.own(this.pool.points.geometry);
    this.maxLife = new Float32Array(row.capacity); this.size0 = new Float32Array(row.capacity); this.flags = new Uint8Array(row.capacity);
  }
  get points(): ParticlePool['points'] { return this.pool.points; }
  get lit(): boolean { return this.row.lit; }
  /** the scene's light (0 … 1) on the spray's look */
  setLight(value: number): void { setLentParam(this.row.look, 'light', value); }
  burst(target: SprayTarget, at: Vector3, direction: Vector3, random: () => number): void {
    const { pos, vel, life, data: { aSize, aAlpha, aColor } } = this.pool, flags = target.flags.reduce((sum, flag) => sum + FLAG[flag], 0);
    for (let k = 0; k < target.count; k++) {
      const a = random() * Math.PI * 2, speed = target.speed * (0.3 + random() * 0.7), tint = 1 - target.jitter + random() * target.jitter * 2;
      const i = this.pool.claim(), j = i * 3;
      pos[j] = at.x + Math.cos(a) * target.spread * random(); pos[j + 1] = at.y + random() * target.spread; pos[j + 2] = at.z + Math.sin(a) * target.spread * random();
      vel[j] = Math.cos(a) * speed + direction.x * target.push; vel[j + 1] = target.up * (0.6 + random() * 0.8) + direction.y * target.push;
      vel[j + 2] = Math.sin(a) * speed + direction.z * target.push;
      life[i] = this.maxLife[i] = target.life * (0.6 + random() * 0.8); aSize[i] = this.size0[i] = target.size * (0.6 + random() * 0.8);
      aColor[j] = target.colour[0] * tint; aColor[j + 1] = target.colour[1] * tint; aColor[j + 2] = target.colour[2] * tint; aAlpha[i] = 1; this.flags[i] = flags;
    }
    if (target.count > 0) { this.pool.attr.aColor.needsUpdate = true; this.live = this.row.capacity; }
  }
  update(dt: number, game: Game): void {
    if (this.live <= 0) return;
    setLentParam(this.row.look, 'scale', pointScale(game.renderer, game.camera));
    const { pos: P, vel: V, life: L, data: { aSize, aAlpha } } = this.pool, [out, fadeIn, floor] = this.row.fade;
    let any = 0;
    for (let i = 0; i < this.row.capacity; i++) {
      const l0 = L[i] ?? 0; if (l0 <= 0) continue;
      any++; const l = l0 - dt; L[i] = l;
      const j = i * 3, f = this.flags[i] ?? 0;
      let vx = V[j] ?? 0, vy = V[j + 1] ?? 0, vz = V[j + 2] ?? 0;
      if (f & GRAVITY) vy -= 9.8 * dt;
      if (f & RISE) vy += 0.6 * dt;
      const drag = f & GRAVITY ? 0.995 : 0.965;
      vx *= drag; vz *= drag; if (!(f & GRAVITY)) vy *= drag;
      const x = (P[j] ?? 0) + vx * dt, z = (P[j + 2] ?? 0) + vz * dt;
      let y = (P[j + 1] ?? 0) + vy * dt;
      if (f & BOUNCE) {
        const ground = heightAt(x, z) + 0.03;
        if (y < ground) { y = ground; vy = Math.abs(vy) * 0.25; vx *= 0.45; vz *= 0.45; if (Math.abs(vy) < 0.4) { vy = 0; vx *= 0.5; vz *= 0.5; } }
      }
      V[j] = vx; V[j + 1] = vy; V[j + 2] = vz; P[j] = x; P[j + 1] = y; P[j + 2] = z;
      const k = l > 0 ? l / (this.maxLife[i] ?? 1) : 0;
      aAlpha[i] = Math.min(1, k * out) * Math.min(1, (1 - k) * fadeIn + floor);
      if (f & GROW) aSize[i] = (this.size0[i] ?? 0) * (1 + (1 - k) * 2.2);
    }
    this.live = any;
    this.pool.posAttr.needsUpdate = true; this.pool.attr.aAlpha.needsUpdate = true; this.pool.attr.aSize.needsUpdate = true;
  }
}

/** Client-only cue director over real audio, particle, spray and effect-field owners.
 * Callers supply cue ids and native point/direction values, never handlers. */
export class CueDirector {
  /** Borrow a declared director from this entered product without creating another owner. */
  static entered(ctx:ShardContext,id:string):CueDirector|undefined { return clientNativeBook(ctx).presentations.get(id); }

  private readonly rows: CueDirectorRows;
  private readonly fields = new Map<string, EffectField>();
  private readonly sprays = new Map<string, CueSpray>();
  private readonly at = new Vector3(); private readonly direction = new Vector3();
  private readonly random = (): number => this.game.app.rng.stream('cosmetic').next();
  private readonly game: Game; private readonly scope: Scope; private readonly sounds: CombatCues | undefined;
  constructor(game: Game, input: unknown, scope: Scope = game.levelScope, sounds?: CombatCues) {
    this.game = game; this.scope = scope; this.sounds = sounds;
    this.rows = parse(CueDirectorSchema, input);
    if (this.rows.rows.some(row => row.sound !== undefined) && sounds === undefined) throw new Error('Cue director requires its native sound owner');
    for (const row of this.rows.sprays ?? []) {
      const spray = new CueSpray(row, scope); this.sprays.set(row.id, spray);
      game.scene.add(spray.points); scope.onDispose(() => { spray.points.removeFromParent(); });
    }
  }
  /** The scene's light (0 … 1) on every `lit` spray. */
  setLight(value: number): void { for (const spray of this.sprays.values()) if (spray.lit) spray.setLight(value); }
  /** Advance the sprays (and, once installed, the fields) by `dt`. */
  update(dt: number): void {
    for (const field of this.fields.values()) field.update(dt);
    for (const spray of this.sprays.values()) spray.update(dt, this.game);
  }
  /** Prepare the declared fields using the resident scene's compiled looks.
   * Its entered scope owns geometry and clocks, borrowing material lifetime. */
  static install(ctx: ShardContext, input: unknown, clock: 'owner' | 'system' = 'system'): CueDirector {
    const runtime = ctx.game.runtime;
    if (runtime?.world === undefined || runtime.world === null) throw new Error('Cue director requires its entered world');
    const director = new CueDirector(runtime.world.game, input, ctx.scope, runtime.play?.cues);
    for (const row of director.rows.fields) {
      const material = sceneModelSource(ctx.product, row.library).look(row.look);
      if (material === undefined) throw new Error(`Missing cue field look: ${row.look}`);
      const field = effectField(row, material); director.fields.set(row.id, field);
      ctx.root.add(field.object); ctx.scope.own(field.geometry); ctx.scope.onDispose(() => { field.object.removeFromParent(); });
      if (row.place !== undefined) field.place(new Vector3(...row.place.at), new Vector3(...row.place.aim));
    }
    if (clock === 'system') ctx.system({ id: 'cue.director', phase: 'update', run: dt => { director.update(dt); } });
    return director;
  }
  /** Preserve one shared salt per cue, synchronous VFX-before-sound order,
   * and scope-owned delayed dispatch with copied source positions. */
  cue(id: string, point: Vector3, direction: Vector3): void {
    if (this.scope.disposed) throw new Error('Cue director owner is disposed');
    const row = this.rows.rows.find(candidate => candidate.id === id);
    if (row === undefined) throw new Error(`Unknown directed cue: ${id}`);
    for (const target of row.vfx) if (target.kind === 'field' && !this.fields.has(target.field)) throw new Error(`Unprepared cue field: ${target.field}`);
    if (row.delay !== undefined && row.delay > 0) {
      const at = point.clone(), aim = direction.clone();
      this.scope.timeout(row.delay * 1000, () => { this.dispatch(row, at, aim); });
    } else this.dispatch(row, point, direction);
  }
  private dispatch(row: CueDirectorRows['rows'][number], point: Vector3, direction: Vector3): void {
    const salt = row.vfx.some(target => target.kind === 'field') ? this.game.app.rng.stream('cosmetic').next() : 0;
    for (const target of row.vfx) {
      this.at.set(point.x + target.offset[0], point.y + target.offset[1], point.z + target.offset[2]); this.direction.copy(direction);
      if (target.kind === 'impact') {
        if (target.reverse) this.direction.negate();
        Impacts.for(this.game).burst(target.material, this.at, this.direction, target.count);
      } else if (target.kind === 'spray') {
        const spray = this.sprays.get(target.spray);
        if (spray === undefined) throw new Error(`Unprepared cue spray: ${target.spray}`);
        spray.burst(target, this.at, direction, this.random);
      } else {
        this.at.x += direction.x * target.ahead; this.at.z += direction.z * target.ahead;
        const field = this.fields.get(target.field);
        if (field === undefined) throw new Error(`Unprepared cue field: ${target.field}`);
        field.burst(this.at, direction, salt);
      }
    }
    if (row.sound !== undefined) {
      if (this.sounds === undefined) throw new Error('Cue sound owner is absent');
      this.sounds.cue(row.sound as `cue.${string}`, row.soundPhase === undefined ? {} : { phase: row.soundPhase });
    }
  }
}
