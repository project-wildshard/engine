import { Vector3 } from 'three';
import { StrikeRunner, type StrikeSpec, type StrikeActor } from '@wildshard/engine/ai/strikes';
import type { WorldContactRequest, WorldContactHit, WorldContactDispatcher } from '@wildshard/engine/combat/contactWeapon';
import { test as testFlags, type Flags } from '@wildshard/engine/world/interact/flags';
import { parseWorldTargets, type WorldTargets, type WorldTarget } from '@wildshard/format/worldTargets';

/** Existing authoritative owners, lent by platform quest installation, never by shard callbacks. */
export interface WorldTargetOwners {
  readonly flags: Pick<Flags, 'has' | 'set'>;
  readonly interactions: ReadonlyMap<string, { run: () => boolean }>;
  readonly hints: { show: (text: string) => void };
}
/** A geometric contact can be absorbed without applying a mechanic (for example, a wrong move's hint). */
export interface WorldTargetOutcome extends WorldContactHit { readonly id: string; readonly caught: boolean; readonly applied: boolean }
/** The existing page/native contact owner. Borrowing it installs no clock or input lane. */
export interface WorldTargetLanding { bindWorldTargets: (owner: WorldContactDispatcher | null) => void }

/** Data-only contact policy on the existing strike contact primitive. It owns no step, guest, timers, saves or bodies. */
export class WorldTargetHost implements WorldContactDispatcher {
  private readonly rows: WorldTargets['targets'];
  private readonly owners: WorldTargetOwners;
  private readonly runner = new StrikeRunner();
  private readonly origin = new Vector3();
  private readonly actor: StrikeActor = { position: this.origin, alive: true, scale: 1, yaw: 0,
    startAttack: () => undefined, cancelAttack: () => undefined, setMotion: () => undefined };
  constructor(input: unknown, owners: WorldTargetOwners) {
    this.rows = parseWorldTargets(input).targets; this.owners = owners;
    for (const row of this.rows) for (const rule of row.rules) for (const effect of rule.effects) {
      if (effect.kind === 'interaction' && !owners.interactions.has(effect.id)) throw new Error(`Missing world target interaction ${effect.id}`);
    }
  }
  /** The contact family uses the first absorbed contact solely for its existing catch presentation. */
  contact(request: WorldContactRequest): WorldContactHit | null { return this.scan(request).find(row => row.caught) ?? null; }
  /** Geometry selects before gates or move rules; a refused nearest target never exposes the target behind it. */
  scan(request: WorldContactRequest): readonly WorldTargetOutcome[] {
    if (![request.from.x, request.from.y, request.from.z, request.dir.x, request.dir.y, request.dir.z, request.reach, request.width].every(Number.isFinite) || request.reach < 0 || request.reach > 100 || request.width < 0 || request.width > 100) throw new Error('Invalid world contact aim');
    const candidates: { row: WorldTarget; at: Vector3; distance: number }[] = [];
    this.origin.copy(request.from);
    for (const row of this.rows) {
      if (row.weapon !== request.weapon) continue;
      const at = new Vector3(...row.at), scan = row.scan;
      const spec: StrikeSpec = { id: row.id, units: 'world', shape: scan.kind === 'cone'
        ? { kind: 'cone3d', length: scan.reach, halfAngle: scan.halfAngle }
        : { kind: 'ray3d', length: request.reach + row.radius, radius: request.width + row.radius },
        range: scan.kind === 'cone' ? scan.reach : request.reach, windup: 0, active: 0, recover: 0, cooldown: 0, damage: 0, tags: [], weight: () => 1 };
      if (this.runner.contact(spec, { actor: this.actor, origin: request.from, direction: request.dir, target: at,
        canReach: () => true, hit: () => undefined })) {
        candidates.push({ row, at, distance: scan.kind === 'ray' ? at.clone().sub(request.from).dot(request.dir) : 0 });
      }
    }
    const first = candidates[0];
    const selected = first?.row.scan.selection === 'nearest'
      ? candidates.reduce<typeof candidates>((best, entry) => best.length === 0 || entry.distance < (best[0]?.distance ?? Infinity) ? [entry] : best, []) : candidates;
    const results: WorldTargetOutcome[] = [];
    for (const { row, at } of selected) {
      if (!testFlags(this.owners.flags, row.needs)) continue;
      const rule = row.rules.find(value => value.move === request.move && value.contact === request.contact);
      if (rule === undefined) continue;
      let applied = rule.effects.length > 0;
      // An interaction refusal must not leave subsequent flag or hint effects behind.
      for (const effect of rule.effects) if (effect.kind === 'interaction' && this.owners.interactions.get(effect.id)?.run() !== true) { applied = false; break; }
      if (applied) for (const effect of rule.effects) {
        if (effect.kind === 'flag') this.owners.flags.set(effect.id);
        else if (effect.kind === 'hint') this.owners.hints.show(effect.text);
      }
      results.push({ id: row.id, at, radius: row.radius, applied,
        caught: rule.caught === 'always' || rule.caught === 'if-applied' && applied });
    }
    return results;
  }
}
