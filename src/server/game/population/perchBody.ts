import { MixedPopulationSchema, type MixedPopulationRows } from '@wildshard/format/mixedPopulation';
import type { AnimalRigContext } from '@wildshard/engine/entities/animalRig';
import type { AnimalSim } from '@wildshard/engine/entities/AnimalSim';
import type { Rng } from '@wildshard/engine/core/rng';
import type { PerchHunterPorts } from '@wildshard/engine/ai/guardianPolicy';
import { Scope } from '@wildshard/engine/app/scope';
import { numericCreaturePose } from '../../../shared/game/plugin/channelPrograms';
import * as v from 'valibot';
import { Vector3 } from 'three';
import { StrikeRunner, type StrikeSpec } from '@wildshard/engine/ai/strikes';
import { admitSpeciesProgram, createMemoryActionBrain, type SpeciesDecision, type SpeciesDecisionAuthority } from '../plugin/brain';
import type { SpeciesProgramData } from '@wildshard/format/speciesPrograms';
import type { SpeciesRow } from '@wildshard/engine/ai/species';
import type { ShardContext } from '../../../client/game/plugin/context';
import { strikeFromData } from '@wildshard/engine/ai/strikeRows';
import { projectedSite } from './projectedSites';
import { stepPerchRoot } from '../../../shared/game/population/perchRoot';
import { ReturnProgram } from '../../../shared/game/population/returnProgram';
import type { SimHost } from '@wildshard/engine/sim';

/** Existing page/native perception; policy and root names remain admitted data. */
export interface PerchBodyPorts<A extends AnimalSim> extends Omit<PerchHunterPorts<A>, 'pickPerch' | 'setPerch' | 'attackRandom'> {
  rng: Rng;
  readonly world: { readonly perches?: readonly A['position'][] | undefined; readonly perchBases?: readonly A['position'][] | undefined;
    readonly throwCoconut?: ((from: A['position'], target: A['position'], thrower: A) => void) | undefined };
  heightAt: (x: number, z: number) => number;
  reach: (actor: A) => boolean;
  hurt: (damage: number) => void;
}
/** Native perch policy adapter: admitted memory gates select built-in strike and
 * physical launch effects. The guest selects habitat sites and projected heights. */
export function bindPerchBody<A extends AnimalSim, C extends PerchBodyPorts<A>>(actor: A, first: C, decision: SpeciesDecision<A>, bite: StrikeSpec,
  guest: ReturnProgram, row: MixedPopulationRows['perch'], attackRandom: Pick<Rng, 'range'> = first.rng): ReturnType<typeof createMemoryActionBrain<A, C>> {
  if (decision.archetype !== 'perch-hunter') throw new Error('Perch body requires its declared policy');
  const contact = new StrikeRunner(), from = new Vector3(), to = new Vector3();
  let current = first;
  const ports = { ...first, attackRandom,
    pickPerch: (a: A, min: number, max: number, away?: A['position']): number => {
      const points = (current.world.perches ?? []).map((p, index) => ({ x: p.x, z: p.z,
        occupied: current.herd?.some(h => h !== a && h.alive && h.mem['perch'] === index) === true ? 1 : 0 }));
      return projectedSite(points, guest, { signal: row.score, limit: 1024, origin: a.position, minimum: min, maximum: max,
        observations: {}, ...(away === undefined ? {} : { away }) }, current.rng)?.index ?? -1;
    },
    setPerch: (a: A, index: number): void => {
      const p = current.world.perches?.[index], base = current.world.perchBases?.[index] ?? p;
      if (p === undefined || base === undefined) throw new Error('Missing declared perch');
      const height = guest.project(row.height, { y: p.y, ground: current.heightAt(p.x, p.z) })[row.heightChannel];
      if (height === undefined) throw new Error('Missing perch height channel');
      const root = row.root;
      Object.assign(a.mem, { perch: index, [root.x]: p.x, [root.z]: p.z, [root.baseX]: base.x, [root.baseZ]: base.z, [root.height]: height });
    },
  };
  return createMemoryActionBrain<A, C>(actor, row.actions, { decide: (_a, context) => {
    current = context; Object.assign(ports, context); decision.policy.think(ports);
  }, effects: new Map([
    ['bite', (a: A, c: C): void => {
      if (contact.contains(bite, { actor: { position: a.position, scale: a.scale, yaw: a.yaw }, target: c.player }) && (bite.tags.includes('cover.exempt') || c.reach(a))) {
        c.hurt(bite.damage); c.sound(row.sound);
      }
    }],
    ['throw', (a: A, c: C): void => {
      from.set(a.position.x, a.position.y + row.sourceHeight * a.scale, a.position.z);
      to.set(c.player.x, c.player.y + row.targetHeight, c.player.z); c.world.throwCoconut?.(from, to, a);
    }],
  ]) });
}

/** Bind the projection to the installed host's admitted terrain. */
export function nativePerchProgram(host: SimHost, input: unknown): ReturnProgram { return ReturnProgram.native(host, input); }

/** Page binding reuses native perch selection, strikes and root integration.
 * Clips and all policy-channel names arrive as rows; no shard callback is retained. */
export class PerchBodyBinding {
  readonly row: { kind: string; strike: string; sound: string; sourceHeight: number; targetHeight: number; attackStream?: "ai" | "spawn" | "gameplay" | "cosmetic"; actions: { stateKey: string; states: (string)[]; actions: ({ state: number; phase: number; effect: string; once: { key: string; value: number; test: "falsy" | "not-value"; }; when?: { key: string; test: "truthy" | "falsy"; }; })[]; }; score: string; height: string; heightChannel: string; root: { drop: string; velocity: string; land: string; climb: string; height: string; baseX: string; baseZ: string; x: string; z: string; gravity: number; speed: number; landing: number; }; };
  readonly guest: ReturnProgram;
  readonly animate: (c: AnimalRigContext) => void;
  constructor(input: unknown, owner: Scope | SimHost) {
    const rows = v.parse(v.strictObject({ clips: v.array(v.unknown()), program: v.unknown(), perch: MixedPopulationSchema.entries.perch }), input);
    this.row = rows.perch;
    this.guest = owner instanceof Scope ? ReturnProgram.page(rows.program, owner) : ReturnProgram.native(owner, rows.program);
    const poses = rows.clips.map(numericCreaturePose);
    this.animate = c => { stepPerchRoot(c, rows.perch.root); for (const pose of poses) pose(c); };
  }
  /** Bind admitted species through the actual page RNG owner. Stream creation
   * remains lazy until the policy draws its cooldown; no author hook enters. */
  species(ctx: ShardContext, program: SpeciesProgramData, decisions?: SpeciesDecisionAuthority): SpeciesRow[] {
    const brains = admitSpeciesProgram(program), row = this.row, stream = row.attackStream;
    const bite = program.strikes.find(strike => strike.id === row.strike);
    if (bite === undefined || stream === undefined) throw new Error('Perch species requires its strike and cooldown stream');
    const strike = strikeFromData(bite), random = { range: (min: number, max: number): number => ctx.app.rng.stream(stream).range(min, max) };
    return program.species.map(species => ({ ...species, ...(species.kind === row.kind
      ? brains.bind(species.kind, (actor, decision, first) => {
        if (first === undefined) throw new Error('Perch species requires its first page observation');
        return bindPerchBody(actor, first, decision, strike, this.guest, row, random);
      }) : brains.bind(species.kind, undefined, undefined, undefined, decisions)) }));
  }
}
