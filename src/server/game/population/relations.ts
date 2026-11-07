import type { AnimalSim } from '@wildshard/engine/entities/AnimalSim';
import type { Animal } from '@wildshard/engine/entities/AnimalView';
import type { PackBrain } from '@wildshard/engine/ai/pack';
import type { HerdBrain } from '@wildshard/engine/ai/herd';
import type { CrowdTargets } from '../../../shared/game/shardfile/crowdRuntime';
import type { ReturnProgram } from '../../../shared/game/population/returnProgram';

/** Portable group effects use existing pack, herd and crowd owners. Content contributes
 * event-law ids and effect radii; no new brain or body clock is installed. */
export class PopulationRelations<A extends AnimalSim = Animal> {
  constructor(private readonly program: ReturnProgram,
    private readonly groups: { readonly packs: readonly Pick<PackBrain<A>, 'members' | 'awareness' | 'scare'>[];
      readonly herds: readonly Pick<HerdBrain<A>, 'members' | 'cx' | 'cz' | 'stampeding' | 'disturb' | 'stampede'>[];
      readonly crowds: readonly Pick<CrowdTargets, 'cx' | 'cz' | 'scare'>[] },
    private readonly row: { readonly alert: string; readonly range: string; readonly packRadius: number;
      readonly disturbRadius: number; readonly disturbSeconds: number; readonly scareSeconds: number }) {}
  alert(x: number, z: number): void {
    for (const herd of this.groups.herds) for (const actor of herd.members) {
      const result = this.program.project(this.row.alert, { x, z, px: actor.position.x, pz: actor.position.z, awareness: actor.mem['aw'] ?? 0 });
      if (result['accept'] === 1) actor.mem['aw'] = result['awareness'] ?? 0;
    }
    for (const pack of this.groups.packs) for (const actor of pack.members) if (actor.alive) {
      const result = this.program.project(this.row.alert, { x, z, px: actor.position.x, pz: actor.position.z, awareness: pack.awareness });
      if (result['accept'] === 1) { pack.awareness = result['awareness'] ?? 0; break; }
    }
  }
  disturb(x: number, z: number): void {
    for (const herd of this.groups.herds) herd.disturb(x, z);
    for (const view of this.groups.crowds) if (this.admitted(x, z, view.cx, view.cz, this.row.disturbRadius)) view.scare(x, z, this.row.disturbSeconds);
  }
  scare(x: number, z: number, radius: number): void {
    for (const pack of this.groups.packs) pack.scare(x, z, this.row.packRadius);
    for (const herd of this.groups.herds) if (this.admitted(x, z, herd.cx, herd.cz, radius)) herd.stampede(x, z);
    for (const view of this.groups.crowds) if (this.admitted(x, z, view.cx, view.cz, radius)) view.scare(x, z, this.row.scareSeconds);
  }
  ripple(): void { for (const herd of this.groups.herds) if (herd.stampeding) for (const pack of this.groups.packs) pack.scare(herd.cx, herd.cz, this.row.packRadius); }
  private admitted(x: number, z: number, px: number, pz: number, radius: number): boolean { return this.program.project(this.row.range, { x, z, px, pz, radius })['accept'] === 1; }
}


/** Pure native knockback projection from admitted speed/clamp rows. */
export function knockdownVelocity(rows:{speed:number;min:number;max:number},x:number,z:number,strength:number,out:{x:number;z:number}):void{
  const length=Math.hypot(x,z)||1,speed=rows.speed*Math.max(rows.min,Math.min(rows.max,strength));
  out.x=x/length*speed;out.z=z/length*speed;
}
