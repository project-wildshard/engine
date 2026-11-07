import type { Euler, Vector3 } from 'three';
import type { AnimalSim } from './AnimalSim';
import type { RigAnimCtx } from './species/registry';

/** A joint's numeric local transform. Real visual bones and renderer-free joints satisfy the same port. */
export interface AnimalRigJoint { readonly position: Vector3; readonly rotation: Euler; readonly scale: Vector3 }
/** Custom species read the shipping scalar context and write only transforms and owned actor motion. */
export type AnimalRigContext = Omit<RigAnimCtx, 'bones' | 'animal'> & {
  bones: Record<string, AnimalRigJoint>;
  animal: Pick<AnimalSim, 'mem' | 'position' | 'yOffset'>;
};
/** Actor-owned clocks sampled after the scheduled body/overlay phase, plus its corpse leg spread. */
export interface QuadrupedPoseClock {
  readonly bodyY: number; readonly alive: boolean; readonly deathT: number; readonly deathSide: number;
  readonly speed: number; readonly legAbd: Float32Array;
}
const P_BODY_Y=0,P_BODY_PITCH=1,P_BODY_ROLL=2,P_BODY_YAW=3,P_NECK1=4,P_NECK2=5,P_HEAD_P=6,P_HEAD_Y=7,P_NECK_Y=8;
const P_EARL_P=9,P_EARL_Y=10,P_EARR_P=11,P_EARR_Y=12,P_TAIL_P=13,P_TAIL_Y=14,P_LEG=15;
const smooth01=(t:number):number=>t*t*(3-2*t);
type Quad=Record<'body'|'neck1'|'neck2'|'head'|'earL'|'earR'|'tail'|'belly',AnimalRigJoint>;
type Leg=readonly[AnimalRigJoint,AnimalRigJoint,AnimalRigJoint];
/** The shipping scalar-to-joint expressions, without a skeleton, geometry, renderer or scheduler. */
export class QuadrupedRigPose {
  private readonly quad:Quad;
  private readonly legs:readonly Leg[];
  private breathPhase=0;
  constructor(bones:Readonly<Record<string,AnimalRigJoint>>) {
    const bone=(name:string):AnimalRigJoint=>{const value=bones[name];if(value===undefined)throw new Error(`Missing quadruped pose joint: ${name}`);return value;};
    this.quad={body:bone('body'),neck1:bone('neck1'),neck2:bone('neck2'),head:bone('head'),earL:bone('earL'),earR:bone('earR'),tail:bone('tail'),belly:bone('belly')};
    this.legs=[['FL_shoulder','FL_carpus','FL_fetlock'],['FR_shoulder','FR_carpus','FR_fetlock'],['BL_hip','BL_stifle','BL_hock'],['BR_hip','BR_stifle','BR_hock']].map(([a,b,c]):Leg=>{if(a===undefined||b===undefined||c===undefined)throw new Error('Missing quadruped leg');return[bone(a),bone(b),bone(c)];});
  }
  /** Apply only when the owner would pose a nearby quadruped. Locals do not publish collision matrices. */
  apply(pose: Float32Array, dt: number, clock: QuadrupedPoseClock): void {
    const p = pose, b = this.quad;
    b.body.position.y = clock.bodyY + (p[P_BODY_Y] ?? 0);
    b.body.rotation.set(p[P_BODY_PITCH] ?? 0, p[P_BODY_YAW] ?? 0, p[P_BODY_ROLL] ?? 0, 'YXZ');
    b.neck1.rotation.set(p[P_NECK1] ?? 0, (p[P_NECK_Y] ?? 0) * 0.5, 0);
    b.neck2.rotation.set(p[P_NECK2] ?? 0, (p[P_NECK_Y] ?? 0) * 0.5, 0);
    b.head.rotation.set(p[P_HEAD_P] ?? 0, p[P_HEAD_Y] ?? 0, 0);
    b.earL.rotation.set(-(p[P_EARL_P] ?? 0), 0, -(p[P_EARL_Y] ?? 0));   // ear pitch: + = laid back
    b.earR.rotation.set(-(p[P_EARR_P] ?? 0), 0, -(p[P_EARR_Y] ?? 0));
    b.tail.rotation.set(p[P_TAIL_P] ?? 0, 0, p[P_TAIL_Y] ?? 0);
    const dead = !clock.alive ? smooth01(Math.max(0, clock.deathT)) : 0;
    for (let l = 0; l < 4; l++) {
      const leg = this.legs[l];
      if (leg === undefined) continue;
      const [u, m, lo] = leg;
      // keyframed corpse: legs swing sideways by legAbd; ground is local +X when the body rolled onto its left side
      // (side < 0), local -X otherwise
      // Publish the two upper-joint axes together, computing its quaternion once.
      u.rotation.set(-(p[P_LEG + l * 3] ?? 0), u.rotation.y,
        dead * (clock.legAbd[l] ?? 0) * (clock.deathSide < 0 ? 1 : -1));
      m.rotation.x = p[P_LEG + l * 3 + 1] ?? 0;
      lo.rotation.x = p[P_LEG + l * 3 + 2] ?? 0;
    }
    // breathing: the belly bone swells (visible at a few metres), faster after running
    if (clock.alive) {
      const rate = 1.4 + 2.6 * Math.min(1, clock.speed / 6);
      this.breathPhase += rate * dt * 2 * Math.PI * 0.45;
      const br = 0.5 + 0.5 * Math.sin(this.breathPhase);
      const sc = 1 + 0.045 * br;
      b.belly.scale.set(sc, sc * 0.85, 1 + 0.01 * br);
    }
  }
  /** Breathing is the only additional continuation; caller restores joint transforms separately. */
  snapshot():number{return this.breathPhase;}
  /** Pure bounded restore, without posing joints or consuming RNG. */
  restore(value:number):void{if(!Number.isFinite(value)||value<0)throw new Error('Invalid quadruped pose continuation');this.breathPhase=value;}
}
/** Shipping root tilt/flinch law. The actor's position is copied only after custom motion has completed. */
export function applyAnimalRoot(root:Pick<AnimalRigJoint,'position'|'rotation'>,position:Vector3,
  yaw:number,tiltPitch:number,tiltRoll:number,custom:boolean,alive:boolean,flinch:number,flinchPitch:number,flinchRoll:number):void {
  root.position.copy(position);
  const f=custom&&alive?flinch*1.8:0;
  root.rotation.set(tiltPitch+flinchPitch*f,yaw,tiltRoll+flinchRoll*f,'YXZ');
}
