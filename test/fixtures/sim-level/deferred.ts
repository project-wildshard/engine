import * as v from 'valibot';
import type { SimHost, SimSpawn } from '@wildshard/engine/sim';
import type { SimSnapshot } from '@wildshard/engine/sim/snapshot';
import { SIM_LEVEL } from './level';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

const Keeper = v.strictObject({ ticks: v.number(), born: v.number(), generation: v.number(), active: v.boolean() });
export function deferredRecipe(generation: number): SimSpawn {
  const base = SIM_LEVEL.entities[0];
  if (base === undefined) throw new Error('Missing native fixture recipe');
  return { ...base, id: `deferred:${generation}`, seed: 70 + generation, at: { x: 0, y: 0, z: 1.6 },
    strike: { ...SIM_LEVEL.weapon, id: 'deferred.strike', windup: 0.1, damage: 1 } };
}
/** A real deferred keeper; installation reinstates actors without advancing its respawn clock. */
export function installDeferred(host: SimHost, saved?: Readonly<Pick<SimSnapshot, 'adapters'>>): void {
  let state = { ticks: 0, born: -16, generation: 0, active: false };
  const spawn = (): void => { host.spawn(deferredRecipe(state.generation)); };
  host.onStep('fixture.keeper', () => {
    state.ticks++;
    if (!state.active && state.ticks === state.born + 20) {
      state.born = state.ticks; state.generation++; state.active = true; spawn();
      host.startStrike(`deferred:${state.generation}`, leadPlayer(host).id);
    }
    if (state.active && state.ticks === state.born + 12) { host.retire(`deferred:${state.generation}`); state.active = false; }
  }, { snapshot: () => ({ ...state }), restore: value => { state = v.parse(Keeper, value); } });
  if (saved !== undefined) {
    const keeper = saved.adapters.find(adapter => adapter.id === 'fixture.keeper');
    state = v.parse(Keeper, keeper?.state);
    if (state.active) spawn();
  }
}
