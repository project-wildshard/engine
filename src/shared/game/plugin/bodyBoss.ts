import { Vector3 } from 'three';
import * as v from 'valibot';
import { easeField } from '@wildshard/engine/world/easedFields';
import type { BossScript } from '@wildshard/engine/ai/BossBrain';

/** Minimal real body driven by checkpoint health and phase-memory patterns; no rig or renderer is required. */
export interface BodyBossActor {
  readonly position: Vector3; hp: number; readonly maxHp: number; alive: boolean; readonly mem: Record<string, number>;
}
/** A fresh body per checkpoint, phase marks and eased weather; the native actor brain owns its attacks. */
export interface SpawnedBossRow {
  readonly arena: { readonly x: number; readonly z: number; readonly r: number };
  readonly hpShares: readonly number[]; readonly riseSeconds: number; readonly stormPhases: readonly number[]; readonly stormFade: number;
  readonly fields: { readonly fight: string; readonly rise: string; readonly phase: string };
}
/** Actual factory and ordered retirement, reward and view ports for the spawned-body pattern. */
export interface SpawnedBossPorts<B extends BodyBossActor> {
  readonly body: { readonly spawn: (previous: B | undefined) => B | null; readonly retire: (actor: B) => void };
  readonly rewardPoint: Vector3; readonly respawnPoint: () => { pos: Vector3; yaw: number }; readonly victory: () => void;
  readonly update?: (dt: number, storm: number) => void;
}
/** The original spawned-body continuation; actor identity and body state remain in the roster's continuation. */
export interface SpawnedBossState { stormGoal: number; storm: number; invulnerable: boolean }
/** Spawned-body fight, including restore adoption without spawning or consuming RNG. */
export interface SpawnedBossFight<B extends BodyBossActor> {
  readonly script: BossScript; readonly weather: { storm: number }; readonly body: () => B | null;
  readonly adopt: (actor: B | null) => void; readonly invulnerable: () => boolean;
  readonly snapshot: () => SpawnedBossState; readonly restore: (state: SpawnedBossState) => void;
}
/** One retained body through every checkpoint; its native brain resets in place and retains its own attack clock. */
export interface HeldBossRow {
  readonly arena: { readonly x: number; readonly z: number; readonly r: number; readonly floor: number };
  readonly hpShares: readonly number[]; readonly rewardPoint: { readonly x: number; readonly y: number; readonly z: number };
  readonly respawn: { readonly x: number; readonly y: number; readonly z: number; readonly yaw: number };
}
/** The retained body's native phase and restart port, shared by the page and renderer-free host. */
export interface HeldBossBrain { phase: number; fighting: boolean; restart: () => void }
/** Native retained body and brain; null retains the original absent-body policy. */
export interface HeldBossPorts<B extends BodyBossActor> {
  readonly body: B | null; readonly brain: HeldBossBrain | null; readonly victory: (at: Vector3) => void;
}
/** Retained-body continuation, preserving the original serialized field order and absent-body semantics. */
export interface HeldBossFight {
  readonly script: BossScript; readonly shielded: () => boolean;
  readonly snapshot: () => { hp: number; invulnerable: boolean }; readonly restore: (value: unknown) => void;
}
/** The two body patterns: the checkpoint law the page and the renderer-free host both run, with no brain of its own. */
export type BodyBossProfile =
  | { readonly kind: 'boss'; readonly pattern: 'spawned'; readonly fight: SpawnedBossRow }
  | { readonly kind: 'boss'; readonly pattern: 'held'; readonly fight: HeldBossRow };

const heldFinite = v.pipe(v.number(), v.finite());
const HeldContinuation = v.strictObject({ hp: heldFinite, invulnerable: v.boolean() });
/** The body's health/phase driver shares one BossScript clock; each pattern keeps its native reset and continuation. */
export function bodyBossFight<B extends BodyBossActor>(profile: Extract<BodyBossProfile,{pattern:'spawned'}>, ports: SpawnedBossPorts<B>): SpawnedBossFight<B>;
/** A retained body, with its native brain restart and absent-body semantics. */
export function bodyBossFight<B extends BodyBossActor>(profile: Extract<BodyBossProfile,{pattern:'held'}>, ports: HeldBossPorts<B>): HeldBossFight;
/** Each pattern refuses the other's host ports. */
export function bodyBossFight<B extends BodyBossActor>(profile: BodyBossProfile, ports: SpawnedBossPorts<B>|HeldBossPorts<B>): SpawnedBossFight<B>|HeldBossFight;
export function bodyBossFight<B extends BodyBossActor>(profile: BodyBossProfile, ports: SpawnedBossPorts<B>|HeldBossPorts<B>): SpawnedBossFight<B>|HeldBossFight {
  if (profile.pattern === 'spawned' && 'rewardPoint' in ports) {
    const row = profile.fight, focus = new Vector3(), { spawn, retire } = ports.body, weather = { storm: 0 }, f = row.fields;
    let animal: B | null = null, invulnerable = false, stormGoal = 0;
    const stormEase = { seconds: row.stormFade };
    const goal = (phase: number): number => row.stormPhases.includes(phase) ? 1 : 0;
    const fresh = (): B | null => {
      const previous = animal; if (previous) retire(previous);
      animal = spawn(previous ?? undefined);
      if (animal) { animal.mem[f.fight] = 0; animal.mem[f.rise] = 0; animal.mem[f.phase] = 0; }
      return animal;
    };
    const script: BossScript = {
      inArena: (p) => Math.hypot(p.x - row.arena.x, p.z - row.arena.z) < row.arena.r,
      reset: (checkpoint) => {
        stormGoal = 0; const a = fresh();
        if (a) { a.hp = a.maxHp * (row.hpShares[checkpoint] ?? row.hpShares[row.hpShares.length - 1] ?? 1); a.mem[f.phase] = checkpoint; }
      },
      seal: () => undefined,
      intro: (t) => { if (animal) { animal.mem[f.rise] = Math.min(1, t / row.riseSeconds); focus.copy(animal.position); return focus; } return ports.rewardPoint; },
      begin: (next) => { if (animal) { animal.mem[f.rise] = 1; animal.mem[f.fight] = 1; animal.mem[f.phase] = next; } stormGoal = goal(next); },
      enterPhase: (next) => { if (animal) animal.mem[f.phase] = next; stormGoal = goal(next); },
      update: (dt) => {
        weather.storm = easeField(weather.storm, stormGoal, dt, stormEase);
        ports.update?.(dt, weather.storm);
      },
      get hpFrac() { return animal ? Math.max(0, animal.hp / animal.maxHp) : 0; },
      get shielded() { return invulnerable; },
      get dead() { return animal !== null && !animal.alive; },
      clampHp: (frac) => { if (animal) animal.hp = frac * animal.maxHp; },
      setInvulnerable: (on) => { invulnerable = on; },
      victory: () => { stormGoal = 0; ports.victory(); },
      rewardPoint: () => ports.rewardPoint,
      respawnPoint: ports.respawnPoint,
    };
    return { script, weather, body: () => animal, adopt: (actor) => { animal = actor; }, invulnerable: () => invulnerable,
      snapshot: () => ({ stormGoal, storm: weather.storm, invulnerable }),
      restore: (state: SpawnedBossState) => { stormGoal = state.stormGoal; weather.storm = state.storm; invulnerable = state.invulnerable; } };
  }
  if (profile.pattern !== 'held' || !('brain' in ports)) throw new Error('Boss row/host policy mismatch');
  const row = profile.fight, { body, brain } = ports;
  let hp = 1, invulnerable = false;
  const at = new Vector3(row.rewardPoint.x, row.rewardPoint.y, row.rewardPoint.z), last = row.hpShares.length - 1;
  const clamp = (n: number): number => n <= 0 ? 0 : Math.min(last, n);
  const script: BossScript = {
    inArena: (p) => Math.hypot(p.x - row.arena.x, p.z - row.arena.z) < row.arena.r && p.y > row.arena.floor,
    reset: (checkpoint) => { hp = row.hpShares[clamp(checkpoint)] ?? 1; if (brain) { brain.phase = clamp(checkpoint); brain.fighting = false; brain.restart(); }
      if (body) { body.hp = hp * body.maxHp; body.alive = true; } },
    seal: () => undefined, intro: () => at,
    begin: (next) => { if (brain) { brain.phase = clamp(next); brain.fighting = true; } },
    enterPhase: (next) => { if (brain) brain.phase = clamp(next); },
    update: (_dt, _t, fighting) => { if (body) hp = body.hp / body.maxHp; if (brain) brain.fighting = fighting; },
    get hpFrac() { return hp; }, get shielded() { return invulnerable; }, get dead() { return body ? !body.alive : hp === 0; },
    clampHp: (frac) => { hp = frac; if (body) body.hp = frac * body.maxHp; }, setInvulnerable: (on) => { invulnerable = on; },
    victory: () => { ports.victory(at); }, rewardPoint: () => at,
    respawnPoint: () => ({ pos: new Vector3(row.respawn.x, row.respawn.y, row.respawn.z), yaw: row.respawn.yaw }),
  };
  return { script, shielded: () => invulnerable, snapshot: () => ({ hp, invulnerable }),
    restore: (saved: unknown) => { const value = v.parse(HeldContinuation, saved); hp = value.hp; invulnerable = value.invulnerable; } };
}
