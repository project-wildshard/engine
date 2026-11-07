import * as v from 'valibot';
import { Vector3 } from 'three';
import type { AnimalSim } from '@wildshard/engine/entities/AnimalSim';
import type { PackPrey } from '@wildshard/engine/ai/pack';
import type { Rng } from '@wildshard/engine/core/rng';
import type { ReturnProgram } from '../../../shared/game/population/returnProgram';

interface NativeRaidPackPolicy<A> {
  readonly members: readonly A[]; readonly alpha: A | null; readonly alive: number; readonly phase: string;
  readonly prey: PackPrey | null; findPrey?: ((x: number, z: number, radius: number) => PackPrey | null) | undefined;
  raid: (prey: PackPrey) => boolean; scare: (x: number, z: number, radius: number) => void;
}
interface NativePastureFields { readonly n: number; readonly alive: number; readonly cx: number; readonly cz: number; nearest: (x: number, z: number) => number }
const pastureFinite = v.pipe(v.number(), v.finite()), pastureCount = v.pipe(pastureFinite, v.integer(), v.minValue(0));
const PastureState = v.object({ raidT: pastureFinite, pendingT: pastureFinite, raiding: v.picklist([0, 1]), raids: pastureCount, taken: pastureCount, drivenOff: pastureCount,
  cracks: pastureCount, cracksNow: pastureCount, spawned: v.pipe(pastureCount, v.maxValue(2)), crackCd: pastureFinite, restT: pastureFinite, patrolA: pastureFinite });
const PasturePatch = v.partial(PastureState);
const pastureIndexSchema = v.pipe(pastureFinite, v.integer(), v.minValue(-1));
const PastureSaved: v.GenericSchema<BoundedPastureSaveInput, BoundedPastureSave> = v.strictObject({ version: v.literal(3), state: PastureState, elapsed: v.pipe(pastureFinite, v.minValue(0), v.maxValue(.1)), pack: pastureIndexSchema, raiders: pastureIndexSchema, prey: pastureIndexSchema });

/** One native actor roster for the page and server. The admitted v1 guest owns
 * raid admission, timers, outcomes and shepherd decisions at ten Hz. This
 * adapter only observes real bodies and applies their native operations. */
export class NativePastureRaid<A extends AnimalSim, P extends NativeRaidPackPolicy<A>> {
  private state: v.InferOutput<typeof PastureState>;
  private elapsed = 0;
  private pack: P | null = null;
  private raiders: P | null = null;
  private prey: PackPrey | null = null;
  private preyIndex = -1;
  private player = { x: 10000, z: 10000 };
  private blocked = false;
  private readonly direction = new Vector3();
  constructor(private readonly program: ReturnProgram, private readonly random: Rng, readonly shepherd: A | null,
    readonly flock: NativePastureFields | null, private readonly packs: readonly P[], private readonly preyAt: (pastureIndex: number) => PackPrey,
    private readonly spawnPack: (x: number, z: number, variants: string[]) => P, firstRaid: number, private readonly variants: readonly string[],
    private readonly cue: (key: string, actor?: A) => void = () => undefined) {
    this.state = { raidT: firstRaid, pendingT: 0, raiding: 0, raids: 0, taken: 0, drivenOff: 0,
      cracks: 0, cracksNow: 0, spawned: 0, crackCd: 0, restT: 0, patrolA: 0 };
  }
  get raiding(): boolean { return this.state.raiding === 1; }
  get raids(): number { return this.state.raids; }
  get taken(): number { return this.state.taken; }
  get drivenOff(): number { return this.state.drivenOff; }
  get cracks(): number { return this.state.cracks; }
  private project(signal: string, observations: Readonly<Record<string, number>>): Readonly<Record<string, number>> {
    const result = this.program.project(signal, { ...this.state, ...observations }, this.random);
    Object.assign(this.state, v.parse(PasturePatch, result)); return result;
  }
  start(force = false, player: { x: number; z: number; } = this.player): boolean {
    const f = this.flock, plan = this.project('raidStart', { force: Number(force), blocked: Number(this.blocked),
      alive: f?.alive ?? 0, distance: f === null ? 10000 : Math.hypot(player.x-f.cx, player.z-f.cz),
      cx: f?.cx ?? 0, cz: f?.cz ?? 0, packAlive: this.raiders?.alive ?? 0 });
    if (plan['accept'] !== 1 || f === null) return false;
    if (plan['spawn'] === 1) {
      this.raiders = this.spawnPack(plan['x'] ?? 0, plan['z'] ?? 0, [...this.variants]);
      this.raiders.findPrey = undefined; this.state.spawned++;
    }
    const pack = this.raiders;
    if (this.project('raidReady', { packAlive: pack?.alive ?? 0, ready: Number(pack?.phase === 'roam') })['accept'] !== 1 || pack === null) return false;
    const lead = pack.alpha?.alive === true ? pack.alpha : pack.members.find(w => w.alive);
    if (lead === undefined) return false;
    const i = f.nearest(lead.position.x, lead.position.z);
    if (i < 0) return false;
    const prey = this.preyAt(i); if (!pack.raid(prey)) return false;
    this.pack = pack; this.prey = prey; this.preyIndex = i;
    this.project('raidBegin', {}); this.cue('start'); return true;
  }
  update(dt: number, player: { readonly x: number; readonly z: number }, wolves: readonly A[], now: number, blocked = false): void {
    this.player = player; this.blocked = blocked; this.elapsed += dt;
    if (this.elapsed + 1e-9 < .1) return;
    const step = this.elapsed; this.elapsed = 0;
    const result = this.project('raidTick', { dt: step, present: Number(this.pack !== null && this.prey !== null),
      tracking: Number(this.pack !== null && this.pack.prey === this.prey), broken: Number(this.pack?.phase === 'break'), preyAlive: Number(this.prey?.alive === true) });
    if (result['attempt'] === 1 && !this.start()) this.project('raidRetry', {});
    if (result['outcome'] === 1) this.cue('taken'); else if (result['outcome'] === 2) this.cue('drivenOff');
    const h = this.shepherd, f = this.flock;
    if (h === null || f === null || !h.alive) return;
    // Observation only: source-order nearest live wolf in the pasture radius.
    let wolf: A | null = null, distance = 50;
    for (const body of wolves) {
      const d = Math.hypot(body.position.x-f.cx, body.position.z-f.cz);
      if (body.alive && d < distance) { wolf = body; distance = d; }
    }
    const motion = this.project('shepherd', { dt: step, px: h.position.x, pz: h.position.z, yaw: h.yaw, cx: f.cx, cz: f.cz,
      wolf: Number(wolf !== null), wx: wolf?.position.x ?? 0, wz: wolf?.position.z ?? 0, time: now, seed: h.seed });
    const states = ['idle', 'graze', 'wander', 'flee'] as const;
    h.state = states[motion['state'] ?? 0] ?? 'idle'; h.setMotion(motion['yaw'] ?? h.yaw, motion['speed'] ?? 0, motion['turn'] ?? 2.2);
    if (motion['crack'] !== 1 || wolf === null) return;
    this.direction.set(motion['x'] ?? 0, 0, motion['z'] ?? 0); wolf.stagger(this.direction, .8); wolf.cancelAttack();
    wolf.mem['lunge'] = 3; wolf.mem['lt'] = 1.1;
    if (motion['scare'] === 1) this.packs.find(pack => pack.members.includes(wolf))?.scare(wolf.position.x, wolf.position.z, 25);
    this.cue('crack', wolf);
  }
  snapshot(): v.InferOutput<typeof PastureSaved> { return { version: 3, state: { ...this.state }, elapsed: this.elapsed,
    pack: this.pack === null ? -1 : this.packs.indexOf(this.pack), raiders: this.raiders === null ? -1 : this.packs.indexOf(this.raiders), prey: this.preyIndex }; }
  restore(input: unknown): void {
    const saved = v.parse(PastureSaved, input);
    const pack = (i: number): P | null => { const p = this.packs[i]; if (i !== -1 && p === undefined) throw new Error('Unknown raid pack'); return p ?? null; };
    const active = pack(saved.pack), raiders = pack(saved.raiders);
    if (saved.prey >= (this.flock?.n ?? 0)) throw new Error('Unknown raid sheep');
    const prey = saved.prey === -1 ? null : this.preyAt(saved.prey);
    this.state = saved.state; this.elapsed = saved.elapsed; this.pack = active; this.raiders = raiders; this.preyIndex = saved.prey; this.prey = prey;
  }
}


/** Complete admitted data, independent of validator implementation metadata. */
type BoundedPastureSaveInput = BoundedPastureSave;
interface BoundedPastureSaveFields {
    version: 3;
    state: {
        raidT: number;
        pendingT: number;
        raiding: 0 | 1;
        raids: number;
        taken: number;
        drivenOff: number;
        cracks: number;
        cracksNow: number;
        spawned: number;
        crackCd: number;
        restT: number;
        patrolA: number;
    };
    elapsed: number;
    pack: number;
    raiders: number;
    prey: number;
}
type BoundedPastureSave = { [Key in keyof BoundedPastureSaveFields]: BoundedPastureSaveFields[Key] };
