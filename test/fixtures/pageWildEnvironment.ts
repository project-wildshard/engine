import { pageApp } from '@wildshard/engine/app/pageSeat';
import type { Scope } from '@wildshard/engine/app/scope';
import { readScalarLattice } from '@wildshard/engine/world/scalarChannel';
import { PageGroupRowsSchema } from '@wildshard/format/creatures';
import * as v from 'valibot';
import { WildSenses } from '../../src/server/game/population/nativeManager';
import type { ReturnProgram } from '../../src/shared/game/population/returnProgram';
import { grassBaseHeightAt } from '../../src/shared/game/systems/looks/grassField';

// The observation surface the old page population ran its senses on. Its oracles still compare the native law against it.
/** Client-only observations over the installed native grass and terrain. A scope
 * lends numeric weather/player state and a baked wet mask; no query hook binds. */
export class PageWildEnvironment extends WildSenses {
  wind = { x: 0,z: -1,strength: 0 };
  private author: ReturnProgram | null = null;
  protected senses(): ReturnProgram | null { return this.author; }
  private wet: ((x: number,z: number) => number) | null = null;
  private readonly states = new WeakMap<object,PropertyDescriptorMap>();
  enter(scope: Scope, input: unknown, author: ReturnProgram, wetBlock?: {readonly file:string;readonly bytes:Uint8Array}): void {
    if (input === null || typeof input !== 'object') throw new Error('Missing entered population rows');
    const previous = Object.getOwnPropertyDescriptors(this), state = this.states.get(input);
    // a re-entry restores the state its first entry admitted and built (G639: no second parse in the activation frame)
    if (state !== undefined) { Object.defineProperties(this,state); scope.onDispose(() => { this.states.set(input,Object.getOwnPropertyDescriptors(this)); Object.defineProperties(this,previous); }); return; }
    const rows = v.parse(PageGroupRowsSchema,input), world = rows.world;
    const blocks=new Map(wetBlock===undefined?[]:[[wetBlock.file,wetBlock.bytes]]);
    this.wet = readScalarLattice({res:world.res,size:world.size,values:typeof world.wet==='string'
      ?{type:'f32',count:world.res*world.res,data:world.wet}:world.wet},blocks);
    this.wind = { ...rows.wind }; this.author = author;
    scope.onDispose(() => { this.states.set(input,Object.getOwnPropertyDescriptors(this)); Object.defineProperties(this,previous); });
  }
  grassHeightAt(x: number,z: number): number { return grassBaseHeightAt(x,z); }
  grassStandingAt(x: number,z: number): number { return grassBaseHeightAt(x,z); }
  trample(_x: number,_z: number,_radius: number,_strength: number,_vx: number,_vz: number): void { /* no grass in a fixture */ }
  wetAt(x: number,z: number): boolean { return (this.wet?.(x,z) ?? 0) > .5; }
  onEvent(name: string,x: number,z: number): void { pageApp().events.emit('creature.signal',{ name,x,z }); }
  onKnockdown(x: number,z: number,strength: number): void { pageApp().events.emit('creature.knockdown',{ x,z,strength }); }
}
/** The entered page's observation surface; construction installs no service. */
export const wildEnv: PageWildEnvironment = new PageWildEnvironment();
