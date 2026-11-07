import {Vector3} from 'three';
import type {Animal} from '../../src/client/engine/entities/AnimalView';
import type {ThinkCtx} from '../../src/shared/engine/entities/species/registry';
import {ANIMAL_STATES} from '../../src/shared/engine/entities/animalStates';
import {app} from '../../src/client/engine/app/runtime';
import {terrainHeight as heightAt} from '../../src/shared/engine/world/terrainHeight';
import type {Rng} from '../../src/shared/engine/core/rng';
import type {ReturnProgram} from '../../src/shared/game/population/returnProgram';
import type {CrowdTargets} from '../../src/shared/game/shardfile/crowdRuntime';
export interface OriginalGuardBinding {
  row:{signal:string;clock:string;every:number;straggler:number;bark:string;soundHeight:number;
    memory:{bark:string;rest:string;snarl:string;low:string};states:string[]};
  flock:CrowdTargets;wolves:readonly Animal[];author:ReturnProgram;random:Rng;
}
const guards=new WeakMap<Animal,OriginalGuardBinding>(),stragglerPoint=new Vector3();
export function bindOriginalPageGuard(actor:Animal,bound:OriginalGuardBinding):void{guards.set(actor,bound);}
/** Frozen pre-H4 page callback; only imports and its test binding publisher differ. */
export function originalPageGuard(actor: Animal, context: ThinkCtx): void {
  const bound = guards.get(actor);
  if (bound === undefined || !actor.alive) { actor.setMotion(actor.yaw, 0, 1); return; }
  const { row, flock, author } = bound, point = actor.position, memory = actor.mem;
  const previous = memory[row.clock], dt = previous === undefined ? context.dt : context.t - previous;
  if (previous !== undefined && dt < row.every - 1e-9) return;
  let threat: Animal | null = null, distance = Infinity;
  for (const candidate of bound.wolves) {
    const d = Math.hypot(candidate.position.x - flock.cx, candidate.position.z - flock.cz);
    if (candidate.alive && d < distance) { threat = candidate; distance = d; }
  }
  const straggler = flock.straggler(row.straggler); if (straggler >= 0) flock.positions(straggler, stragglerPoint);
  const answer = author.project(row.signal, { px: point.x, py: point.y, pz: point.z, cx: flock.cx, cz: flock.cz, dt,
    bark: memory[row.memory.bark] ?? 0, rest: memory[row.memory.rest] ?? 0, wolf: Number(threat !== null), distance: threat === null ? 0 : distance,
    wx: threat?.position.x ?? 0, wy: threat?.position.y ?? 0, wz: threat?.position.z ?? 0,
    straggler: Number(straggler >= 0), sx: stragglerPoint.x, sy: stragglerPoint.y, sz: stragglerPoint.z,
    playerX: context.player.x, playerY: context.player.y, playerZ: context.player.z }, bound.random);
  const out = (key: string): number => { const value = answer[key]; if (value === undefined) throw new Error('Missing crowd guardian output'); return value; };
  memory[row.clock] = context.t; memory[row.memory.bark] = out('bark'); memory[row.memory.snarl] = out('snarl'); memory[row.memory.low] = out('low');
  if (answer['rest'] !== undefined) memory[row.memory.rest] = out('rest');
  const state = ANIMAL_STATES.find(value => value === row.states[out('state')]); if (state === undefined) throw new Error('Invalid crowd guardian state');
  actor.state = state; actor.lookTarget.set(out('lookX'), out('lookY'), out('lookZ')); actor.lookWeight = out('look');
  const path = out('path'), yaw = path > 0 ? context.pathYaw(actor, out('x'), out('z'), path) : out('yaw');
  if (path < 0) actor.setMotion(yaw, out('speed'), out('turn')); else context.steer(actor, yaw, out('speed'), out('turn'));
  if (out('emit') !== 0) app.events.emit('creature.sound', { cue: row.bark, x: point.x, y: heightAt(point.x, point.z) + row.soundHeight, z: point.z });
  context.confine(actor);
}
