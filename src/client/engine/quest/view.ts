import * as v from 'valibot';
import type * as THREE from 'three';
import { ObjectiveLine, type DialogueBox } from './view/ui';
import type {DialogueEntry,NpcDef} from '../../../shared/engine/quest/core';
import {NpcReading} from '../../../shared/engine/quest/dialogueClock';
import type { Flags } from '../../../shared/engine/world/interact/flags';
import type { Interactable } from '../../../shared/engine/world/interact/types';
import { emitFault } from '../../../shared/engine/core/faults';

/** a quest marker resolved to world coordinates */
export interface LiveMarker { id: string; label: string; short: string; x: number; z: number }

/** what the quest chip (ObjectiveLine) shows: the goal's label and count and the live markers */
interface ChipSource {
  /** the chip's goal: a short label and its counter ('' for none) */
  chip: () => { label: string; count: string };
  /** the live markers; the nearest one past 6 m is the chip's nav half */
  markers: () => LiveMarker[];
}

/** the quest chip under the minimap (QuestUI's ObjectiveLine) fed from a quest: goal + nearest marker, ~10 Hz */
export class QuestChip {
  readonly line: ObjectiveLine = new ObjectiveLine();
  private navT = 0;
  private readonly src: ChipSource;
  constructor(src: ChipSource) {
    this.src = src;
  }

  update(t: number, player: { position: THREE.Vector3; yaw: number }): void {
    this.line.update(t);
    if (t - this.navT <= 0.1) return;
    this.navT = t;
    const pp = player.position;
    const chip = this.src.chip();
    this.line.set(chip.label, chip.count);
    let best: LiveMarker | null = null, bd = Infinity;
    for (const m of this.src.markers()) { const d = Math.hypot(m.x - pp.x, m.z - pp.z); if (d < bd) { bd = d; best = m; } }
    if (best && bd > 6) {
      // bearing relative to the view: forward = (−sin yaw, −cos yaw), right = (cos yaw, −sin yaw) (Player / main.ts)
      const dx = best.x - pp.x, dz = best.z - pp.z, sy = Math.sin(player.yaw), cy = Math.cos(player.yaw);
      this.line.setNav(best.short, bd, Math.atan2(dx * cy - dz * sy, -dx * sy - dz * cy));
    } else this.line.setNav(null, 0, 0);
  }
}

/** an NPC talk's parts: the dialogue box, the quest flags and the NPC's lines */
export interface NpcTalkOpts {
  dialogue: DialogueBox;
  flags: Flags;
  npc: NpcDef;
  /** where the prompt sits (the NPC's head) */
  at: THREE.Vector3;
  /** the prompt's reach (metres); the talk closes past radius + 2.5 */
  radius: number;
  label: string;
  /** gestures while the dialogue is open */
  speaker: { talking: boolean };
  /** a talk opened (a sound, turning to face you) */
  onOpen?: (entry: DialogueEntry) => void;
  /** a talk finished (after its `sets` are raised) */
  onDone?: (entry: DialogueEntry) => void;
  /** A voice with no remaining dialogue can still open its shop or offer. */
  onEmpty?: () => void;
}

/** one NPC's talk prompt + dialogue over a (shared) DialogueBox */
export class NpcTalk {
  readonly prompt: Interactable;
  private mine = false;
  private reading: NpcReading | null = null;
  private readonly o: NpcTalkOpts;
  constructor(o: NpcTalkOpts) {
    this.o = o;
    const r = o.radius; // The dialogue can be entry-owned: constructing the prompt must not read its getter.
    this.prompt = {
      position: o.at,
      get radius() { return o.dialogue.isOpen ? 0 : r; },   // hidden while talking: the box has its own NEXT (E / a tap)
      label: o.label,
      wireId: `${o.npc.id}.talk`,
      onInteract: () => { this.talk(); },
    };
  }

  get talking(): boolean { return this.mine && this.o.dialogue.isOpen; }

  talk(): void {
    const { dialogue, flags, npc, speaker } = this.o;
    if (dialogue.isOpen) { dialogue.advance(); return; }
    const reading=new NpcReading(npc,flags,this.o.at,this.o.radius,0,()=>dialogue.readingClock),entry=reading.select();
    if (!entry) { this.o.onEmpty?.(); return; }
    speaker.talking = true;
    this.reading = reading; this.mine = true;
    dialogue.open(npc.name, entry.lines, () => {
      speaker.talking = false;
      this.mine = false;
      reading.finish();
      this.o.onDone?.(entry);
    });
    this.o.onOpen?.(entry);
  }

  /** every frame: walking off closes the talk */
  update(player: THREE.Vector3): void {
    if (!this.mine) return;
    if (!this.o.dialogue.isOpen) { this.mine = false; this.o.speaker.talking = false; return; }
    if (this.reading?.outside(player) === true) { this.o.dialogue.close(false); this.o.speaker.talking = false; this.mine = false; }
  }
}

const guideFinite = v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(1000000));
const GuideProfile = v.strictObject({
  distance: v.picklist(['centre', 'edge']), min: guideFinite, max: v.exactOptional(guideFinite),
  schedule: v.variant('kind', [
    v.strictObject({ kind: v.literal('idle'), wander: guideFinite, idle: guideFinite, idleSpeed: guideFinite, cooldown: guideFinite, retry: guideFinite }),
    v.strictObject({ kind: v.literal('periodic'), initial: guideFinite,
      period: v.pipe(v.tuple([guideFinite, guideFinite]), v.check(([lo, hi]) => lo > 0 && hi >= lo)) }),
  ]),
});

/** The saved journal's points, borrowed without changing their identity. */
export interface GuidePoint { readonly id: string; readonly x: number; readonly z: number; readonly r: number }

interface GuidePorts<P extends GuidePoint> {
  readonly points: () => readonly P[]; readonly discovered: (id: string) => boolean;
  readonly position: () => { readonly x: number; readonly z: number };
  readonly fly: (point: P, force: boolean) => boolean;
  readonly time?: () => number; readonly random?: (lo: number, hi: number) => number;
}

/** One preflighted place-guide schedule and target selector. Flight, pose and
 * random sources belong to its caller; this controller owns no saved state.
 * Periodic schedules draw their next delay before eligibility or flight;
 * idle schedules preserve progress, retry and successful-guide cooldowns.
 */
export class PlaceGuide<P extends GuidePoint> {
  private reportedFrame = false;
  private readonly profile: v.InferOutput<typeof GuideProfile>;
  private readonly ports: GuidePorts<P>;
  private sinceProgress = 0;
  private idle = 0;
  private cooldown: number;
  private next = 0;

  constructor(input: unknown, ports: GuidePorts<P>) {
    const profile = v.parse(GuideProfile, input);
    if (profile.max !== undefined && profile.max < profile.min) throw new RangeError('Invalid guide target range');
    if (profile.schedule.kind === 'periodic' && (ports.time === undefined || ports.random === undefined)) throw new Error('Periodic guide requires its clock and random owner');
    this.profile = profile; this.ports = ports;
    this.cooldown = profile.schedule.kind === 'idle' ? profile.schedule.idle : 0;
    if (profile.schedule.kind === 'periodic') this.next = this.time() + profile.schedule.initial;
  }

  /** Progress restarts only the wander clock, leaving retry/idle state intact. */
  progressed(): void { this.sinceProgress = 0; }

  /** First nearest undiscovered point, using centre or edge distance as authored. */
  target(): P | null {
    const points = this.ports.points(), at = this.ports.position();
    if (points.length > 4096 || !Number.isFinite(at.x) || !Number.isFinite(at.z)) throw new RangeError('Invalid guide points or position');
    let best: P | null = null, nearest = Infinity;
    for (const point of points) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.z) || !Number.isFinite(point.r) || point.r < 0) throw new RangeError('Invalid guide point');
      if (this.ports.discovered(point.id)) continue;
      const centre = Math.hypot(point.x - at.x, point.z - at.z), edge = centre - point.r;
      const distance = this.profile.distance === 'edge' ? edge : centre;
      if (this.profile.distance === 'edge' ? edge <= 0 || distance < this.profile.min : centre < Math.max(this.profile.min, point.r)) continue;
      if (this.profile.max !== undefined && distance > this.profile.max) continue;
      if (distance < nearest) { nearest = distance; best = point; }
    }
    return best;
  }

  /** An explicit guide request does not consume or restart its schedule. */
  attempt(force = false): P | null { const target = this.target(); return target !== null && this.ports.fly(target, force) ? target : null; }

  /** Call only in the caller's active world phase. Eligibility is read lazily
   * when due; periodic ineligible attempts still consume their next delay.
   */
  update(dt: number, speed = 0, eligible: () => boolean = () => true): void {
    try { this.updateFrame(dt, speed, eligible); }
    catch (error) {
      if (!this.reportedFrame) { this.reportedFrame = true; emitFault({system: 'quest.guide', error, verdict: 'retry'}); }
    }
  }
  /** A refused automatic schedule never escapes into unrelated frame work.
   * Direct target/attempt APIs keep their source and ownership refusals. */
  private updateFrame(dt: number, speed: number, eligible: () => boolean): void {
    if (!Number.isFinite(dt) || dt < 0 || !Number.isFinite(speed) || speed < 0) throw new RangeError('Invalid guide step');
    const schedule = this.profile.schedule;
    if (schedule.kind === 'periodic') {
      if (this.time() < this.next) return;
      const nextBase = this.time(), [lo, hi] = schedule.period, delay = this.ports.random?.(lo, hi);
      if (delay === undefined || !Number.isFinite(delay) || delay < lo || delay > hi) throw new RangeError('Invalid guide delay');
      this.next = nextBase + delay;
      if (eligible()) this.attempt();
      return;
    }
    this.sinceProgress += dt; this.idle = speed < schedule.idleSpeed ? this.idle + dt : 0;
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.cooldown > 0 || this.sinceProgress < schedule.wander && this.idle < schedule.idle || !eligible()) return;
    const target = this.target();
    if (target === null) { this.cooldown = schedule.cooldown; return; }
    if (this.ports.fly(target, false)) { this.cooldown = schedule.cooldown; this.sinceProgress = 0; this.idle = 0; }
    else this.cooldown = schedule.retry;
  }

  private time(): number { const now = this.ports.time?.(); if (now === undefined || !Number.isFinite(now)) throw new RangeError('Invalid guide clock'); return now; }
}
