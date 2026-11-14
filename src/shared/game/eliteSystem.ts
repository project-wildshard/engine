/**
 * The named elite system's rules, renderer-free (SF72): the generic half of `Elites` (src/client/game/Elite.ts) with no bar, banner,
 * drop orb, minimap skull or sting, so a renderer-free host runs the very rules the page does. `Elites` is this plus its view:
 * it answers the hooks (the bar's show / caption / pin, the banner, the drop orb, the stings) and draws the focus the update
 * returns. One implementation, two hosts.
 *
 *   const core = new EliteCore(host, hooks, slug, persistence);
 *   core.add(script);                                 // one per elite: its def + its brain
 *   const focus = core.update(dt, t);                 // the nearest aware / engaged elite (the view's bar), or null
 *
 * The rules (docs/design/nalati/elites-and-bosses.md §1): the spawn rule and the one-alive lair, aware → engaged → leash
 * (walk home, regenerate to full), phase 2 at 50 % (a 1 s invulnerable beat), the banner once per approach (re-armed after
 * 60 s beyond the leash), death → the play-time respawn timer (a dusk / night elite waits for the next dusk), a `once`
 * elite retiring, discovery within 60 m. Persistence is the host's (`EliteCorePersistence`): the page's save slot, or a
 * renderer-free host's continuation.
 */

import * as v from 'valibot';
import { EliteCoreContinuationSchema, type EliteCoreContinuation } from '@wildshard/format/eliteContinuation';
import { emitFault } from '@wildshard/engine/core/faults';
import { nearestOnGround } from '@wildshard/engine/sim/nearPlayer';

export type EliteCoreRule = 'always' | 'dusk' | 'night' | 'storm';

/** The fields of an elite's definition the rules read. */
export interface EliteCoreDef {
  readonly id: string;
  readonly lair: { readonly x: number; readonly z: number; readonly r: number };
  readonly awareR: number; readonly engageR: number; readonly leashR: number;
  readonly rule: EliteCoreRule;
  /** minutes of play before the lair wakes again */
  readonly respawnMin: number;
  /** what the first kill leaves: its skin, or null for none */
  readonly drop?: { readonly skin: string | null } | undefined;
}

/** What the rules read and write of an elite's body: the page's Animal and a renderer-free host's body alike. */
export interface EliteCoreActor {
  readonly alive: boolean;
  readonly position: { readonly x: number; readonly z: number };
  hp: number; readonly maxHp: number;
  readonly lastHitT: number;
}

/** One elite's brain as the rules drive it (the page's `EliteScript` is this plus its bar fill and drop model). */
export interface EliteCoreScript<A extends EliteCoreActor = EliteCoreActor> {
  readonly def: EliteCoreDef;
  /** the elite's body while it is out (null otherwise) */
  readonly animal: A | null;
  /** place it at the lair (the rule holds and no timer runs) */
  spawn: () => void;
  /** take it out of the world (its rule ended, unengaged) */
  despawn: () => void;
  /** per frame while it is out: its AI glue. `engaged` = the fight is on; `leashing` = walking home */
  tick: (dt: number, t: number, engaged: boolean, leashing: boolean) => void;
  /** PF5: before each tick, whether it idles out of the player's reach (beyond `awareR`, unhit): it may pause its steps */
  cadence?: (far: boolean) => void;
  enterPhase2: () => void;
  /** the fight reset (leash): back to phase 1 */
  reset: () => void;
  /** beaten, not killed (Argymaq: BROKEN) — the system treats it as the end of the fight */
  broken?: () => boolean;
  /** a trophy into the pack (every kill) */
  trophy: () => void;
  /** won for good (the once elite, tamed): the lair retires */
  retired?: () => boolean;
  /** an extra spawn condition on top of the rule (Qara Batyr: five ghost riders killed tonight) */
  canSpawn?: () => boolean;
}

export type EliteCoreState = 'absent' | 'idle' | 'aware' | 'engaged' | 'leash' | 'dead' | 'broken' | 'retired';

/** One lair's live state. */
export interface EliteCoreEntry<S extends EliteCoreScript = EliteCoreScript> {
  script: S; state: EliteCoreState;
  /** seconds of play left before it may spawn again */
  timer: number;
  /** a dusk / night elite waits for the NEXT dusk after its timer */
  waitDusk: boolean;
  discovered: boolean; bannerArmed: boolean; farT: number;
  phase2: boolean; beatT: number; lockHp: number;
  seenSig: boolean; leashT: number; lastHit: number;
  /** dev-spawned: out whatever its rule */
  forced: boolean;
  /** How many banners and signature moves it has shown: a row's moments. No part of a save. */
  banners: number; signatures: number;
  /** Where a first kill's orb lies, on a host that lays one out. No part of a save: a kill drops it again, as a page's did. */
  drop: { readonly x: number; readonly y: number; readonly z: number } | null;
}

/** One lair's persisted record (the page's 'ws.elites.v1' row). */
export interface EliteCoreRecord { timer: number; discovered: boolean; skinTaken: boolean; kills: number; retired: boolean }

export interface EliteCorePersistence {
  read: (slug: string) => Record<string, EliteCoreRecord>;
  write: (value: Record<string, EliteCoreRecord>, slug: string) => void;
}

/** A player as the rules read it. */
export interface EliteCorePlayer {
  readonly position: { readonly x: number; readonly z: number };
  readonly health: { readonly alive: boolean };
}
/** The world the rules read: the spawn rules, and the page's one player or a room's. A room's elite answers to whoever is
 *  nearest it, and its lair stays held while anyone is near. */
export type EliteCoreHost = { condition: (rule: EliteCoreRule) => boolean } & (
  | { readonly player: { readonly position: { readonly x: number; readonly z: number } }; readonly players?: undefined }
  | { readonly players: ReadonlyMap<string, EliteCorePlayer> });

/** The view's answers to the rules' moments, all optional (a renderer-free host answers none). Each runs where the page ran it. */
export interface EliteCoreHooks<S extends EliteCoreScript> {
  /** a lair spawned its elite (the previous kill's orb, if any, stops being tracked) */
  spawned?: (e: EliteCoreEntry<S>) => void;
  /** a BROKEN elite, every frame (`entering` on the first) */
  broken?: (e: EliteCoreEntry<S>, entering: boolean) => void;
  /** "NAMED ELITE NEARBY": once per approach */
  banner?: (e: EliteCoreEntry<S>) => void;
  /** phase 2 began (after the script's own enterPhase2) */
  phase2?: (e: EliteCoreEntry<S>) => void;
  /** the first sighting of its signature move */
  signature?: (e: EliteCoreEntry<S>) => void;
  /** it fell (after the kill count and the trophy, before it sleeps): `firstSkin` = its skin was never taken */
  fell?: (e: EliteCoreEntry<S>, firstSkin: boolean) => void;
  /** a once elite won for good (after the trophy): `firstSkin` = its prize was never taken */
  won?: (e: EliteCoreEntry<S>, firstSkin: boolean) => void;
  /** the lair retired */
  retired?: (e: EliteCoreEntry<S>) => void;
}

const PageEliteRecords = v.record(v.string(), v.object({ timer: v.number(), discovered: v.boolean(), skinTaken: v.boolean(), kills: v.number(), retired: v.boolean() }));
/** A renderer-free host's persistence: the records live in memory (its continuation carries them). */
export function memoryElitePersistence(level = '', page?: unknown): EliteCorePersistence & { records: Record<string, Record<string, EliteCoreRecord>> } {
  const records: Record<string, Record<string, EliteCoreRecord>> = {}, held = v.safeParse(PageEliteRecords, page);
  if (held.success) records[level] = held.output; // a world's first boot: what a page's save held, timers and all
  return { records, read: (slug) => records[slug] ?? {}, write: (value, slug) => { records[slug] = value; } };
}

const DISCOVER_R = 60, BANNER_R = 80, REARM_T = 60, LEASH_HOME_T = 12;
/** PF5: an idle elite this many times its awareness radius away pauses its fixed steps (`cadence`): idle elites live only
 *  beyond it (inside, the rules make them aware the same frame), so every idle elite holds until it notices or is hit */
const FAR_IDLE_AWARE = 1;

/** The named elite system's rules over any host (see the module doc). */
export class EliteCore<S extends EliteCoreScript> {
  readonly entries: EliteCoreEntry<S>[] = [];
  private saved: Record<string, EliteCoreRecord>;
  private saveT = 0;
  private lastDusk = false;
  private reportedFrames: WeakSet<EliteCoreEntry<S>> | undefined;

  private readonly host: EliteCoreHost;
  private readonly hooks: EliteCoreHooks<S>;
  private readonly slug: string;
  private readonly persistence: EliteCorePersistence;

  constructor(host: EliteCoreHost, hooks: EliteCoreHooks<S>, slug: string, persistence: EliteCorePersistence) {
    this.host = host; this.hooks = hooks; this.slug = slug; this.persistence = persistence;
    this.saved = persistence.read(slug);
  }

  /** The room this core serves, for identity admission before registration. */
  get players(): ReadonlyMap<string, EliteCorePlayer> | undefined { return this.host.players; }
  private near(x: number, z: number): { readonly x: number; readonly z: number } {
    return this.host.players === undefined ? this.host.player.position : nearestOnGround(this.host.players, x, z).position;
  }

  add(script: S): EliteCoreEntry<S> {
    const s = this.saved[script.def.id] ?? { timer: 0, discovered: false, skinTaken: false, kills: 0, retired: false };
    this.saved[script.def.id] = s;
    const entry: EliteCoreEntry<S> = {
      script, state: s.retired ? 'retired' : 'absent', timer: s.timer, waitDusk: false, discovered: s.discovered, bannerArmed: true, farT: 0, banners: 0, signatures: 0, drop: null,
      phase2: false, beatT: 0, lockHp: 0, seenSig: false, leashT: 0, lastHit: -Infinity, forced: false,
    };
    this.entries.push(entry);
    return entry;
  }

  /** Materialize eligible lair actors before restoring a rebuilt world, without advancing AI, timers or rewards. */
  initialize(): void {
    for (const entry of this.entries) {
      if (entry.state !== 'absent' || entry.timer > 0 || entry.waitDusk || entry.script.retired?.() === true
        || !this.host.condition(entry.script.def.rule) || entry.script.canSpawn?.() === false) continue;
      entry.script.spawn(); entry.state = 'idle';
    }
  }

  entry(id: string): EliteCoreEntry<S> | undefined { return this.entries.find((e) => e.script.def.id === id); }
  /** Read a lair another owner keeps as one of these: the same record, so a kill there counts here. */
  share(id: string, record: EliteCoreRecord): void { this.saved[id] = record; }
  /** a lair's persisted record (the view's drop orb marks its skin taken, then saves) */
  record(id: string): EliteCoreRecord | undefined { return this.saved[id]; }
  owned(id: string): boolean { return this.saved[id]?.skinTaken ?? false; }

  /** dev: out now whatever its rule */
  devSpawn(id: string): S['animal'] {
    const e = this.entry(id);
    if (!e || e.state === 'retired') return null;
    if (e.script.animal === null || !e.script.animal.alive) { e.timer = 0; e.script.spawn(); }
    e.state = 'idle'; e.discovered = true; e.forced = true;
    return e.script.animal;
  }

  save(): void {
    for (const e of this.entries) { const s = this.saved[e.script.def.id]; if (s) { s.timer = e.timer; s.discovered = e.discovered; } }
    this.persistence.write(this.saved, this.slug);
  }

  /** the script moved its signature move now: the first time, the view flashes its name */
  signature(id: string): void {
    const e = this.entry(id);
    if (!e || e.seenSig) return;
    e.seenSig = true; e.signatures++;
    this.hooks.signature?.(e);
  }

  /** One frame of the rules; returns the nearest aware / engaged elite (the view's focus). */
  update(dt: number, t: number): EliteCoreEntry<S> | null {
    const dusk = this.host.condition('dusk');
    const duskEdge = dusk && !this.lastDusk; this.lastDusk = dusk;
    let best: EliteCoreEntry<S> | null = null, bestD = Infinity;
    for (const e of this.entries) {
      try {
      const def = e.script.def;
      const home = this.near(def.lair.x, def.lair.z), dl = Math.hypot(home.x - def.lair.x, home.z - def.lair.z);
      if (!e.discovered && dl < DISCOVER_R) { e.discovered = true; this.save(); }
      if (e.state === 'retired') continue;
      if (e.script.retired?.() === true) { this.retire(e); continue; }
      // ── timers and the spawn rule ──
      if (e.state === 'dead' || e.state === 'absent') {
        if (e.timer > 0) { e.timer = Math.max(0, e.timer - dt); if (e.timer === 0 && (def.rule === 'dusk' || def.rule === 'night')) e.waitDusk = true; }
        if (e.waitDusk && duskEdge) e.waitDusk = false;
        if (e.timer <= 0 && !e.waitDusk && this.host.condition(def.rule) && e.script.canSpawn?.() !== false) {
          e.script.spawn(); e.state = 'idle'; e.phase2 = false; e.seenSig = false; this.hooks.spawned?.(e);
        } else continue;
      }
      const a = e.script.animal;
      if (a === null) { e.state = 'absent'; continue; }
      // ── the end of the fight: dead — or BROKEN (beaten, not killed: the taming takes over; thrown, he fights on) ──
      if (!a.alive) { this.fell(e); continue; }
      if (e.script.broken?.() === true) {
        const entering = e.state !== 'broken';
        if (entering) e.state = 'broken';
        this.hooks.broken?.(e, entering);
        continue;
      }
      if (e.state === 'broken') e.state = 'engaged';
      // ── the rule ended: it leaves (never mid-fight) ──
      if (e.state === 'idle' && !e.forced && !this.host.condition(def.rule)) { e.script.despawn(); e.state = 'absent'; continue; }
      const foe = this.near(a.position.x, a.position.z), d = Math.hypot(foe.x - a.position.x, foe.z - a.position.z);
      const hit = a.lastHitT > e.lastHit; if (hit) e.lastHit = a.lastHitT;
      // ── aware / engaged / leash ──
      if (e.state === 'idle' && (d < def.awareR || hit)) { e.state = 'aware'; e.discovered = true; }
      if ((e.state === 'aware' || e.state === 'idle') && (d < def.engageR || hit)) e.state = 'engaged';
      if (e.state === 'aware' && d > def.awareR * 1.3) e.state = 'idle';
      if ((e.state === 'engaged' || e.state === 'aware') && dl > def.leashR) { e.state = 'leash'; e.leashT = 0; e.script.reset(); e.phase2 = false; }
      if (e.state === 'leash') {
        e.leashT += dt;
        a.hp = Math.min(a.maxHp, a.hp + a.maxHp * dt / LEASH_HOME_T);
        if (e.leashT > LEASH_HOME_T || (Math.hypot(a.position.x - def.lair.x, a.position.z - def.lair.z) < def.lair.r * 0.5 && a.hp >= a.maxHp)) { a.hp = a.maxHp; e.state = 'idle'; }
      }
      // ── the banner, once per approach ──
      if (e.bannerArmed && (e.state === 'aware' || e.state === 'engaged' || dl < def.lair.r) && d < BANNER_R) {
        e.bannerArmed = false; e.banners++; this.hooks.banner?.(e);
      }
      if (!e.bannerArmed) { if (dl > def.leashR) { e.farT += dt; if (e.farT > REARM_T) { e.bannerArmed = true; e.farT = 0; } } else e.farT = 0; }
      // ── phase 2 at 50 % ──
      if (!e.phase2 && e.state === 'engaged' && a.hp <= a.maxHp * 0.5) {
        e.phase2 = true; e.beatT = 1; e.lockHp = a.hp;
        e.script.enterPhase2();
        this.hooks.phase2?.(e);
      }
      if (e.beatT > 0) { e.beatT -= dt; if (a.hp < e.lockHp) a.hp = e.lockHp; }
      // PF5: an idle elite beyond its awareness, not just hit, may pause; anything else wakes it before its tick
      e.script.cadence?.(e.state === 'idle' && !hit && d > def.awareR * FAR_IDLE_AWARE);
      e.script.tick(dt, t, e.state === 'engaged', e.state === 'leash');
      if ((e.state === 'aware' || e.state === 'engaged') && d < bestD) { best = e; bestD = d; }
      } catch (error) {
        const reported = this.reportedFrames ??= new WeakSet();
        if (!reported.has(e)) { reported.add(e); emitFault({system: 'elite.rules', error, verdict: 'retry'}); }
      }
    }
    this.saveT += dt;
    if (this.saveT > 10) { this.saveT = 0; this.save(); }
    return best;
  }

  private fell(e: EliteCoreEntry<S>): void {
    const def = e.script.def, s = this.saved[def.id];
    if (!s) return;
    s.kills++;
    e.script.trophy();
    this.hooks.fell?.(e, !s.skinTaken);
    e.state = 'dead'; e.forced = false;
    e.timer = def.respawnMin * 60; e.waitDusk = false;
    this.save();
  }

  /** a once elite won for good (Argymaq tamed): the trophy + the prize, the lair retires */
  won(id: string): void {
    const e = this.entry(id), s = this.saved[id];
    if (!e || !s || e.state === 'retired') return;
    s.kills++; e.script.trophy();
    const first = !s.skinTaken;
    if (first) s.skinTaken = true;
    this.hooks.won?.(e, first);
    this.retire(e);
  }

  private retire(e: EliteCoreEntry<S>): void {
    e.state = 'retired';
    const s = this.saved[e.script.def.id]; if (s) s.retired = true;
    this.hooks.retired?.(e);
    this.save();
  }

  /** SERVER-CELLS SC10: a served cell slept this long with nobody in it: a fallen lair's timer spends it (a dusk lair still waits for dusk). */
  slept(seconds: number): void {
    for (const e of this.entries) if ((e.state === 'dead' || e.state === 'absent') && e.timer > 0) {
      e.timer = Math.max(0, e.timer - seconds);
      if (e.timer === 0 && (e.script.def.rule === 'dusk' || e.script.def.rule === 'night')) e.waitDusk = true;
    }
  }

  /** Copy the lair rules only, preserving their historical wire field order and null last-hit sentinel. */
  snapshot(): EliteCoreContinuation {
    // A page's save can hold a lair this world has no row for: its record rides along, for the world that has one.
    return { clocks: this.clocks(), records: Object.fromEntries(Object.entries(this.saved).map(([id, row]) => [id,
      { timer: row.timer, discovered: row.discovered, skinTaken: row.skinTaken, kills: row.kills, retired: row.retired }])),
      entries: this.entries.map(e => ({ id: e.script.def.id, state: e.state, timer: e.timer, waitDusk: e.waitDusk, discovered: e.discovered, bannerArmed: e.bannerArmed,
        farT: e.farT, phase2: e.phase2, beatT: e.beatT, lockHp: e.lockHp, seenSig: e.seenSig, leashT: e.leashT, lastHit: e.lastHit === -Infinity ? null : e.lastHit, forced: e.forced })) };
  }
  /** Validate the complete ordered lair roster before returning a quiet commit. No script, hook, persistence write or RNG runs.
   * Prepare alongside caller-owned script/body validation; invoke only after all participants have admitted the save. */
  prepareRestore(value: unknown): () => void {
    const state = v.parse(EliteCoreContinuationSchema, value), entries = [...this.entries];
    if (state.entries.length !== entries.length || state.entries.some((row, i) => row.id !== entries[i]?.script.def.id)) throw new Error('Incompatible elite core continuation');
    return () => {
      if (this.entries.length !== entries.length || entries.some((entry, i) => this.entries[i] !== entry)) throw new Error('Elite core roster changed during restore');
      this.restoreClocks(state.clocks, state.records);
      state.entries.forEach((row, i) => {
        const entry = entries[i];
        if (entry === undefined) throw new Error('Missing admitted elite entry');
        const { id: _id, lastHit, ...rest } = row;
        Object.assign(entry, rest, { lastHit: lastHit ?? -Infinity });
      });
    };
  }

  /** The rules' own clocks for a continuation (the entries and the records ride beside them). */
  clocks(): { saveT: number; lastDusk: boolean } { return { saveT: this.saveT, lastDusk: this.lastDusk }; }
  restoreClocks(clocks: { saveT: number; lastDusk: boolean }, records: Record<string, EliteCoreRecord>): void {
    this.saveT = clocks.saveT; this.lastDusk = clocks.lastDusk;
    for (const [id, row] of Object.entries(records)) { const s = this.saved[id]; if (s) Object.assign(s, row); else this.saved[id] = { ...row }; }
  }
  /** every lair's record (a continuation's copy) */
  records(): Record<string, EliteCoreRecord> { return Object.fromEntries(Object.entries(this.saved).map(([id, row]) => [id, { ...row }])); }
}
