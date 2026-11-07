import {Vector3} from 'three';
import type {AnimalSim} from '../../src/shared/engine/entities/AnimalSim';
import type {Rng} from '../../src/shared/engine/core/rng';
import type {FlockThreat} from '../../src/shared/engine/ai/flock';
import type {ReturnProgram} from '../../src/shared/game/population/returnProgram';
import type {V2CrowdColumns} from '../../src/shared/engine/script/observationColumnsV2';
/** Frozen pre-H4 native guard callback, including original clock/RNG/effect order. */
export class OriginalNativeGuard {
  private readonly sheep=new Vector3();
  private readonly missing=new Error('Missing native population context');
  constructor(private readonly host:{clock:{now:number};player:{position:Vector3};rng:{stream:(name:'ai')=>Rng}},
    private readonly hunt:{pathYawFor:(actor:AnimalSim,x:number,z:number,every:number)=>number;steerAny:(actor:AnimalSim,yaw:number,speed:number,turn:number)=>void;confine:(actor:AnimalSim)=>void},
    private readonly flocks:readonly (V2CrowdColumns&{dog:AnimalSim|null})[],private readonly wolves:readonly FlockThreat[],
    private readonly rows:{dogDecision:string;stragglerDistance:number},private readonly author:ReturnProgram){}
  step(actor: AnimalSim, dt: number): void {
    const flock = this.flocks.find(row => row.dog === actor);
    if (flock === undefined) { actor.setMotion(actor.yaw, 0, 1); return; }
    let nearest: FlockThreat | null = null, distance = Infinity;
    for (const wolf of this.wolves) { const d = Math.hypot(wolf.position.x - flock.cx, wolf.position.z - flock.cz); if (wolf.alive && d < distance) { distance = d; nearest = wolf; } }
    const straggler = flock.straggler(this.rows.stragglerDistance); if (straggler >= 0) flock.positions(straggler, this.sheep);
    const p = actor.position, memory = actor.mem, player = this.host.player.position;
    memory['dogThinkAt'] = this.host.clock.now;
    const answer = this.author.project(this.rows.dogDecision, { px: p.x, py: p.y, pz: p.z, cx: flock.cx, cz: flock.cz, dt,
      bark: memory['barkT'] ?? 0, rest: memory['rest'] ?? 0, wolf: Number(nearest !== null), distance: nearest === null ? 0 : distance,
      wx: nearest?.position.x ?? 0, wy: nearest?.position.y ?? 0, wz: nearest?.position.z ?? 0, straggler: Number(straggler >= 0),
      sx: this.sheep.x, sy: this.sheep.y, sz: this.sheep.z, playerX: player.x, playerY: player.y, playerZ: player.z }, this.host.rng.stream('ai'));
    const n = (key: string): number => { const value = answer[key]; if (value === undefined || !Number.isFinite(value)) throw this.missing; return value; };
    memory['barkT'] = n('bark'); memory['snarl'] = n('snarl'); memory['low'] = n('low'); if (answer['rest'] !== undefined) memory['rest'] = n('rest');
    const state = (['idle', 'alert', 'stalk', 'wander'] as const)[n('state')]; if (state === undefined) throw this.missing;
    actor.state = state; actor.lookTarget.set(n('lookX'), n('lookY'), n('lookZ')); actor.lookWeight = n('look');
    const path = n('path'), yaw = path > 0 ? this.hunt.pathYawFor(actor, n('x'), n('z'), path) : n('yaw');
    if (path < 0) actor.setMotion(yaw, n('speed'), n('turn')); else this.hunt.steerAny(actor, yaw, n('speed'), n('turn')); this.hunt.confine(actor);
  }
}
