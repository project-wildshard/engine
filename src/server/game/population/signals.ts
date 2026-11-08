import type { SimHost } from '@wildshard/engine/sim';
import { sayFightView } from '@wildshard/engine/sim/shardRows';

/** One ordered transport of actual native population outputs, never commands. */
export function installPopulationSignals(host: SimHost): void {
  host.events.on('creature.signal',({name,x,z})=>{sayFightView(host,`creature.signal:${name}`,[x,z]);},host.scope);
  host.events.on('creature.sound',({cue,x,y,z})=>{sayFightView(host,`creature.sound:${cue}`,[x,y,z]);},host.scope);
  host.events.on('creature.knockdown',({x,z,strength})=>{sayFightView(host,'creature.knockdown',[x,z,strength]);},host.scope);
}
