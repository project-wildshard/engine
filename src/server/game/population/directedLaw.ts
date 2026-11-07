/**
 * A directed species' binding (Nalati's ghost riders), renderer-free (CI12: sp-x8's Node tape drives the real riders with
 * it): the 10 Hz guest decision that publishes a body's state and motion toward the target the director wrote into its
 * memory, and the hit's damage scale by the player's distance. The program arrives through `program` (the page pages the
 * entry's admitted one at each call; a native host passes its own); no hunt, clock or randomness of its own is added.
 * `DirectedSpecies` (directedSpecies.ts) is the page's.
 *
 *   const binding = new DirectedLaw(recipe, () => program).binding;   // { think, damageMul? } for the species registry
 */
import * as v from 'valibot';
import { DirectedSpeciesSchema } from '@wildshard/format/speciesLooks';
import { ANIMAL_STATES } from '@wildshard/engine/entities/animalStates';
import type { AnimalState } from '@wildshard/engine/entities/AnimalSim';
import type { SpeciesDef } from '@wildshard/engine/entities/species/registry';
import { eliteDamageMul } from '@wildshard/engine/entities/eliteBrain';
import type { ReturnProgram } from '../../../shared/game/population/returnProgram';

interface Point { readonly x: number; readonly z: number }
/** what the law reads and writes of a body: the page's Animal and a native body both are one */
export interface DirectedActor {
  readonly position: Point; readonly yaw: number; readonly mem: Record<string, number>;
  readonly lookTarget: { copy: (point: { readonly x: number; readonly y: number; readonly z: number }) => unknown }; lookWeight: number; state: AnimalState;
  setMotion: (yaw: number, speed: number, turn?: number) => void;
}
export interface DirectedContext { readonly t: number; readonly player: { readonly x: number; readonly y: number; readonly z: number } }

export class DirectedLaw {
  private readonly row;
  readonly binding: Pick<SpeciesDef, 'think' | 'damageMul'>;
  /** the hit's scale also takes the elite's own multiplier (`eliteDamageMul`) */
  get elite(): boolean { return this.row.damage?.elite === true; }
  /** whether the recipe scales hits at all */
  get scalesDamage(): boolean { return this.row.damage !== undefined; }
  constructor(recipe: unknown, private readonly program: () => Pick<ReturnProgram, 'project'>) {
    this.row = v.parse(DirectedSpeciesSchema, recipe);
    if (this.row.states.some(state => !ANIMAL_STATES.some(value => value === state))) throw new Error('Invalid directed species states');
    this.binding = {
      think: (actor, context) => { this.decide(actor, context); },
      ...(this.row.damage === undefined ? {} : { damageMul: (actor, point, direction) => {
        const row = this.row.damage; if (row === undefined) return 1;
        return this.damageScale(actor.mem, point) * (row.elite ? eliteDamageMul(actor, point, direction) : 1);
      } }),
    };
  }
  /** The 10 Hz decision for one body (its clock in its memory): state, look and motion toward its target. */
  decide(actor: DirectedActor, context: DirectedContext): void {
    const row = this.row, memory = actor.mem, previous = memory[row.clock];
    if (previous !== undefined && context.t - previous < row.every - 1e-9) return;
    const tx = memory[row.target[0]], tz = memory[row.target[1]];
    const answer = this.program().project(row.signal, { x: actor.position.x, z: actor.position.z, tx: tx ?? 0, tz: tz ?? 0,
      ready: Number(tx !== undefined && tz !== undefined), speed: memory[row.motion[0]] ?? row.speed,
      turn: memory[row.motion[1]] ?? row.turn, threshold: row.threshold, radius: row.stopDistance, yaw: actor.yaw, look: row.look });
    const out = (key: string): number => { const value = answer[key]; if (value === undefined) throw new Error('Missing directed species output'); return value; };
    memory[row.clock] = context.t; actor.lookTarget.copy(context.player); actor.lookWeight = out('look');
    const state = out('state');
    if (state >= 0) { const value = ANIMAL_STATES.find(candidate => candidate === row.states[state]); if (value === undefined) throw new Error('Invalid directed species state'); actor.state = value; }
    actor.setMotion(out('yaw'), out('speed'), out('turn'));
  }
  /** A hit's scale by the player's distance (`mem`: the body's memory, where the director wrote the player), before the
   *  elite's own multiplier; 1 when the recipe scales nothing. */
  damageScale(mem: Readonly<Record<string, number>>, point: Point): number {
    const row = this.row.damage; if (row === undefined) return 1;
    const x = mem[row.player[0]], z = mem[row.player[1]];
    const result = this.program().project(row.signal, { ready: Number(x !== undefined && z !== undefined),
      distance: Math.hypot(point.x - (x ?? 0), point.z - (z ?? 0)), radius: row.radius, scale: row.scale });
    const scale = result['scale']; if (scale === undefined) throw new Error('Missing directed damage output');
    return scale;
  }
}
