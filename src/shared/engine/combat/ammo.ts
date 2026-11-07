import type { CombatTag } from './pipeline';

export type AmmoId = `ammo.${string}`;
export interface AmmoRow {
  id: AmmoId; label: string; name: string; flight: { gravity: number; drag: number };
  wet?: { gravity: number; drag: number }; tags: readonly CombatTag[]; material?: string; pouchMax: number;
}
interface ProjectileModification { ammo: AmmoRow; gravity: number; drag: number }
declare module '../../../client/engine/events/maps' {
  interface AskMap { 'projectile.modify': readonly [ProjectileModification, ProjectileModification] }
}

/** Apply admitted wet-flight increments, preserving authored decimal arithmetic and dry rows. */
export function wetFlight(flight:{gravity:number;drag:number},wet:{gravity:number;drag:number}|undefined,rain:number):{gravity:number;drag:number} {
  if(wet===undefined)return {...flight};const r=Math.max(0,Math.min(1,rain));
  return {gravity:flight.gravity*(1+wet.gravity*r),drag:flight.drag*(1+wet.drag*r)};
}
