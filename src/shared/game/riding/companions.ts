import type { Vector3 } from 'three';
import type { MountProfile } from '@wildshard/format/riding';

/** A rider's horses as numbers and names only (Nalati: name-horse and call-horse): registration under their saved
 *  names, renaming (into the save's names record), the whistle that calls the nearest bonded horse, and each horse's
 *  rest, bolt and come-to-whistle clocks with its prompt's label. No scene, input or HUD: the page's Mount
 *  (mount.ts) and the Node simulation (CI12's Nalati tape) run the same law over their own bodies and prompts. */

/** The horse body the law reads and steers (the page's Animal; the simulation's body). */
export interface CompanionActor {
  readonly entityId: string; readonly kind: string; readonly variant: string; readonly alive: boolean; hp: number; readonly maxHp: number;
  readonly mem: Record<string, number>; readonly position: Vector3; state: string; readonly yaw: number; readonly speed: number;
  readonly seed: number; readonly scale: number; label: string; lookWeight: number; readonly lookTarget: Vector3;
  readonly setMotion: (yaw: number, speed: number, turnRate?: number) => void;
}
/** A horse's mount prompt: its label and reach (0: none). */
export interface CompanionPrompt { label: string; radius: number }
export interface Companion<A extends CompanionActor, P extends CompanionPrompt> {
  readonly a: A; name: string; readonly it: P; restT: number; bolting: boolean; comeT: number;
  /** its key in the saved names (horseNames.ts) */ readonly key: string;
}

/** a horse below this share of its health bolts; it then rests this long (s); a whistle carries this far (m) */
const BOLT_AT = 0.2, REST_TIME = 180, WHISTLE_RANGE = 150;

export class MountCompanions<A extends CompanionActor, P extends CompanionPrompt> {
  readonly list: Companion<A, P>[] = [];
  constructor(private readonly profile: Pick<MountProfile, 'names' | 'restAt' | 'speeds'>) {}
  /** Register a horse under its saved name (or `fallback`), owned; `prompt` makes its mount prompt. Null when it is
   *  one already. */
  add(a: A, fallback: string, savedKey: string | undefined, prompt: (name: string) => P): Companion<A, P> | null {
    const key = savedKey ?? `${fallback}|${a.kind}:${a.variant}`;
    if (this.list.some((m) => m.a === a)) return null;
    const name = this.profile.names[key] ?? fallback;
    if (name !== fallback) a.label = name;
    a.mem['owned'] = 1;
    const m: Companion<A, P> = { a, name, it: prompt(name), restT: 0, bolting: false, comeT: 0, key };
    this.list.push(m);
    return m;
  }
  /** Unregister a horse: the companion it was (its prompt goes with it), or null. */
  remove(a: A): Companion<A, P> | null {
    const i = this.list.findIndex((m) => m.a === a);
    if (i === -1) return null;
    const m = this.list[i];
    this.list.splice(i, 1);
    return m ?? null;
  }
  /** Name a horse: its label and the save's names record (a blank name or an unknown horse changes nothing). */
  rename(a: A, name: string): void {
    const m = this.list.find((x) => x.a === a);
    if (m === undefined || name.length === 0) return;
    m.name = name; a.label = name;
    this.profile.names[m.key] = name;
  }
  nameOf(id: string): string | null { return this.list.find((x) => x.a.entityId === id)?.name ?? null; }
  /** Whether a horse may be ridden as a companion: not resting or bolting (a horse that is none may be). */
  free(a: A): boolean { const m = this.list.find((x) => x.a === a); return m === undefined || (m.restT <= 0 && !m.bolting); }
  /** The whistle: the nearest bonded (mem.whistle) rideable horse within range starts to come (30 s); it, or null. */
  whistle(player: Vector3, canRide: (a: A) => boolean): A | null {
    let best: Companion<A, P> | null = null, bd = WHISTLE_RANGE;
    for (const m of this.list) {
      if (!canRide(m.a) || (m.a.mem['whistle'] ?? 0) === 0) continue;   // only a bonded horse answers (mem.whistle = 1)
      const d = m.a.position.distanceTo(player);
      if (d < bd) { bd = d; best = m; }
    }
    if (best === null) return null;
    best.comeT = 30;
    return best.a;
  }
  /** One frame for every horse: a hurt one bolts (throwing its rider) to its rest spot and rests, healed after; a
   *  whistled one comes to the player; an idle one grazes and watches; then its prompt's label and reach. `ridden` and
   *  `now` are read live (a bolt dismounts mid-frame). */
  update(dt: number, player: Vector3, ports: { readonly ridden: () => A | null; readonly now: () => number; readonly throwRider: () => void;
    readonly bolted: (m: Companion<A, P>) => void }): void {
    const p = player, speeds = this.profile.speeds;
    for (const m of this.list) {
      const a = m.a;
      if (!a.alive) continue;
      if (!m.bolting && m.restT <= 0 && a.hp < a.maxHp * BOLT_AT) {
        m.bolting = true; m.comeT = 0;
        if (ports.ridden() === a) ports.throwRider();
        a.mem['rear'] = 1;
        ports.bolted(m);
      }
      if (m.bolting) {
        a.mem['rear'] = Math.max(0, (a.mem['rear'] ?? 0) - dt * 1.2);
        const r = this.profile.restAt;
        const tx = r?.x ?? a.position.x, tz = r?.z ?? a.position.z;
        const d = Math.hypot(tx - a.position.x, tz - a.position.z);
        if (d > 3 && r !== undefined) { a.state = 'flee'; a.setMotion(Math.atan2(tx - a.position.x, tz - a.position.z), d > 20 ? speeds.gallop * 0.9 : speeds.trot, 2); }
        else { m.bolting = false; m.restT = REST_TIME; a.setMotion(a.yaw, 0, 1); a.state = 'graze'; }
      } else if (m.restT > 0) {
        m.restT -= dt;
        a.state = 'graze';
        if (m.restT <= 0) a.hp = a.maxHp;
      } else if (ports.ridden() !== a && m.comeT > 0) {
        m.comeT -= dt;
        const d = Math.hypot(p.x - a.position.x, p.z - a.position.z);
        if (d > 3.2) { a.state = d > 12 ? 'flee' : 'wander'; a.setMotion(Math.atan2(p.x - a.position.x, p.z - a.position.z), d > 25 ? speeds.gallop * 0.85 : d > 8 ? speeds.canter * 0.7 : speeds.walk, 2.5); }
        else { m.comeT = 0; a.setMotion(Math.atan2(p.x - a.position.x, p.z - a.position.z), 0, 2); a.state = 'idle'; a.mem['toss'] = 1; }
      } else if (ports.ridden() !== a) {
        if (a.speed < 0.1) a.state = Math.sin(ports.now() * 0.2 + a.seed * 9) > 0.1 ? 'graze' : 'idle';
        a.lookTarget.copy(p); a.lookWeight = a.position.distanceTo(p) < 6 && a.state !== 'graze' ? 0.6 : 0;
      }
      const ridden = ports.ridden() === a;
      m.it.label = ridden ? 'Dismount' : m.restT > 0 || m.bolting ? `${m.name} is resting` : `Mount ${m.name}`;
      m.it.radius = ridden ? 3.6 : m.restT > 0 || m.bolting ? 0 : 3.3;
    }
  }
}

/** The naming rail's pick: the companion whose `name` projection (the riding rules) reports the least distance, with
 *  that projection (its prompt's place and reach), or null. */
export function companionToName<A extends CompanionActor, P extends CompanionPrompt>(companions: readonly Companion<A, P>[],
  project: (signal: string, observations: Readonly<Record<string, number>>) => Readonly<Record<string, number>>,
  rail: { readonly x: number; readonly z: number }, player: { readonly x: number; readonly z: number }): { readonly actor: A; readonly row: Readonly<Record<string, number>> } | null {
  let best = Infinity, nearest: { readonly actor: A; readonly row: Readonly<Record<string, number>> } | null = null;
  for (const entry of companions) {
    const a = entry.a, row = project('name', { alive: Number(a.alive), x: a.position.x, z: a.position.z, cx: rail.x, cz: rail.z, px: player.x, pz: player.z, yaw: a.yaw, scale: a.scale });
    const distance = row['distance'] ?? 1e12;
    if (distance < best && distance < 1e12) { best = distance; nearest = { actor: a, row }; }
  }
  return nearest;
}
