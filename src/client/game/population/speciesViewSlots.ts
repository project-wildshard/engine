import type { Object3D } from 'three';
import type { ViewSlotActor, ViewSlots } from '@wildshard/engine/script/viewProgram';

/** What the species pool reads of a live actor (every animal the manager holds has these). */
export interface SpeciesViewActor {
  readonly entityId: string; readonly kind: string; readonly mesh: Object3D;
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly yaw: number; readonly alive: boolean; readonly mem: Readonly<Record<string, number | undefined>>;
  readonly attackPhase: number; readonly scale: number; readonly seed: number; yOffset: number;
}

/** A named actor value a field falls back to when the actor's memory lacks it. */
function actorValue(actor: SpeciesViewActor, name: string): number | undefined {
  switch (name) {
    case 'attackPhase': return actor.attackPhase;
    case 'scale': return actor.scale;
    case 'yOffset': return actor.yOffset;
    case 'seed': return actor.seed;
    default: return undefined;
  }
}
const finite = (value: number | undefined): value is number => value !== undefined && Number.isFinite(value);

/**
 * G600 L7 / L8: every live actor of `kind` as a view pool (a program's pool group `species:<kind>`, engine/script/viewProgram).
 * An actor keeps its slot from first sight until it leaves the manager (despawn; it keeps it through death), then the slot
 * frees; new actors take the lowest free slot in spawn order. `refresh` runs once a frame before the program reads the pool.
 * A slot's fields read the actor's numeric memory, else its attack phase, scale, height offset or seed, else 0; a field
 * `has:<key>` reads 1 when the memory holds `key`, else 0 (a module integrates its own death time from `alive`);
 * `set` writes the actor's visual fields only (its height offset). `animals` is read each refresh (null: none yet).
 */
export function speciesViewSlots(animals: () => readonly SpeciesViewActor[] | null, kind: string, count: number,
  ground: (x: number, z: number) => number): ViewSlots {
  const slots: (SpeciesViewActor | null)[] = Array.from({ length: count }, () => null);
  const view = (actor: SpeciesViewActor): ViewSlotActor => ({
    identity: actor.entityId, object: actor.mesh, x: actor.position.x, y: actor.position.y, z: actor.position.z, yaw: actor.yaw,
    alive: actor.alive, ground: ground(actor.position.x, actor.position.z),
    field: name => {
      if (name.startsWith('has:')) return Number(finite(actor.mem[name.slice('has:'.length)]));
      const own = actor.mem[name]; if (finite(own)) return own; const value = actorValue(actor, name); return finite(value) ? value : 0; },
    set: (name, value) => { if (name !== 'yOffset') throw new Error(`Species view field is not visual: ${name}`); actor.yOffset = value; },
  });
  return {
    refresh: () => {
      const live = (animals() ?? []).filter(actor => actor.kind === kind), present = new Set(live);
      for (const [slot, actor] of slots.entries()) if (actor !== null && !present.has(actor)) slots[slot] = null;
      for (const actor of live) {
        if (slots.includes(actor)) continue;
        const free = slots.indexOf(null); if (free === -1) break;
        slots[free] = actor;
      }
    },
    actor: slot => { const actor = slots[slot] ?? null; return actor === null ? null : view(actor); },
  };
}
