import type { GameClock } from '../../src/shared/engine/core/clock';
import type { ParityFrame } from './frame-bytes.mjs';

export interface FixedWorldFrame extends ParityFrame {
  calls:number;triangles:number;pinned:string[];at:number[];frame:number;
  clock:ReturnType<GameClock['snapshot']>;
  requested:{yaw:number;pitch:number};camera:{world:number[];projection:number[]};
  viewmodel:{included:boolean;draws:number};
}
/** Native M3 world render; compositor and camera children are excluded. */
export function fixedWorldFrame(pose:{yaw:number;pitch:number;includeViewmodel?:boolean}):FixedWorldFrame;
