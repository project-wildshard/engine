import { pageApp } from '@wildshard/engine/app/pageSeat';
import type { Scope } from '@wildshard/engine/app/scope';
import type { V2EnvironmentColumns } from '@wildshard/engine/script/observationColumnsV2';
import { readScalarLattice } from '@wildshard/engine/world/scalarChannel';
import { PageGroupRowsSchema } from '@wildshard/format/creatures';
import * as v from 'valibot';
import { grassBaseHeightAt } from '../../../shared/game/systems/looks/grassField';
import { grassHeightAt, trample } from '../systems/looks/trample';

/** The air a page's views read: its wind, its light, its wet ground and grass, and where its player stands in them. Plain page
 *  state: a creature's senses are the server's, and read their own. */
export class PageAir implements V2EnvironmentColumns {
  wind = { x: 0, z: -1, strength: 0 };
  playerFwdX = 0; playerFwdZ = -1; playerCrouched = false; playerMounted = false; playerHealth01 = 1;
  lastShotT = -1e9; light = 1; storm = false;
  private wet: ((x: number, z: number) => number) | null = null;
  private readonly states = new WeakMap<object, PropertyDescriptorMap>();
  /** Enter a population's rows; its scope gives the page back what it found. */
  enter(scope: Scope, input: unknown, wetBlock?: { readonly file: string; readonly bytes: Uint8Array }): void {
    if (input === null || typeof input !== 'object') throw new Error('Missing entered population rows');
    const previous = Object.getOwnPropertyDescriptors(this), state = this.states.get(input);
    // a re-entry restores the state its first entry admitted and built (G639: no second parse in the activation frame)
    scope.onDispose(() => { this.states.set(input, Object.getOwnPropertyDescriptors(this)); Object.defineProperties(this, previous); });
    if (state !== undefined) { Object.defineProperties(this, state); return; }
    const rows = v.parse(PageGroupRowsSchema, input), { world } = rows;
    this.wet = readScalarLattice({ res: world.res, size: world.size, values: typeof world.wet === 'string' ? { type: 'f32', count: world.res * world.res, data: world.wet } : world.wet },
      new Map(wetBlock === undefined ? [] : [[wetBlock.file, wetBlock.bytes]]));
    this.wind = { ...rows.wind };
  }
  grassHeightAt(x: number, z: number): number { return grassHeightAt(x, z); }
  grassStandingAt(x: number, z: number): number { return grassBaseHeightAt(x, z); }
  trample(x: number, z: number, radius: number, strength: number, vx: number, vz: number): void { trample.push(x, z, radius, strength, vx, vz); }
  wetAt(x: number, z: number): boolean { return (this.wet?.(x, z) ?? 0) > .5; }
  onEvent(name: string, x: number, z: number): void { pageApp().events.emit('creature.signal', { name, x, z }); }
  onKnockdown(x: number, z: number, strength: number): void { pageApp().events.emit('creature.knockdown', { x, z, strength }); }
}
export const pageAir: PageAir = new PageAir();
