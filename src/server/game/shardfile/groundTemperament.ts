import type { AnimalSim } from '@wildshard/engine/entities/AnimalSim';
import type { SimHost, SimStateAdapter } from '@wildshard/engine/sim';
import type { DeclaredBrainRecipe } from './brainRuntime';
import type { TemperamentBrain } from './creatureTemperament';

interface GroundOwner extends SimStateAdapter { provoke: (retarget?: boolean) => boolean; reset: () => void }
/** Keep actual-player selection and deferred wakes separate from native immutable policy bytes.
 * Decisions run here; the outer registration always runs the stock body exactly once afterward. */
export function bindGroundTemperament<P>(host: SimHost, actor: AnimalSim, divisor: number,
  brain: GroundOwner & { think: (ports: P) => void }, recipe: DeclaredBrainRecipe<P>,
  origin: { readonly x: number; readonly y: number; readonly z: number } = actor.position): TemperamentBrain & { target: () => ReturnType<SimHost['nearestPlayer']> | undefined } {
  if (recipe.bindTarget === undefined) throw new Error('Missing layered native target authority');
  let selected: string | null = null, pending: 0 | 1 | 2 = 0, enabled = true;
  const contract = JSON.stringify({ version: 2, divisor, policy: brain.snapshot() });
  const living = (id: string) => {
    const player = host.players.get(id);
    return player?.health.alive === true && !host.parked.has(id) ? player : undefined;
  };
  const target = () => selected === null ? undefined : living(selected);
  recipe.bindTarget(() => enabled ? target() : undefined);
  return { target, provoke: id => {
    if (living(id) === undefined) return;
    if (selected !== id) { selected = id; pending = 2; }
    else if (pending === 0) pending = 1;
  }, reset: () => { selected = null; pending = 0; enabled = true; brain.reset(); }, run: (_dt, acquire = true) => {
    enabled = acquire;
    if (!actor.alive) { selected = null; pending = 0; enabled = false; return; }
    if (acquire && target() === undefined) {
      const player = recipe.nearest === undefined ? host.nearestPlayer(origin) : recipe.nearest();
      selected = player === undefined ? null : living(player.id)?.id ?? null;
    }
    if (!acquire) { actor.cancelAttack(); if (target() === undefined) { selected = null; pending = 0; } }
    if (acquire && pending) {
      if (!actor.mem['init']) brain.think(recipe.observe(0));
      brain.provoke(pending === 2); pending = 0;
    }
    const decisionDt = host.brainDt(actor.entityId, false, divisor);
    if (decisionDt > 0) brain.think(recipe.observe(decisionDt));
    if (!acquire) actor.cancelAttack();
  }, adapter: { snapshot: () => [contract, selected, pending, enabled, brain.snapshot()], restore: saved => {
    if (!Array.isArray(saved) || saved.length !== 5 || saved[0] !== contract
      || (saved[1] !== null && (typeof saved[1] !== 'string' || saved[1].length === 0 || saved[1].length > 128))
      || (saved[2] !== 0 && saved[2] !== 1 && saved[2] !== 2) || typeof saved[3] !== 'boolean' || saved[4] === undefined)
      throw new Error('Incompatible grounded temperament continuation');
    brain.restore(saved[4]); selected = saved[1]; pending = saved[2]; enabled = saved[3];
  } } };
}
