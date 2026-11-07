import type { DrawingBuffer } from '../../render/viewmodelFeel';
import type * as THREE from 'three';
import type { Game } from '../../core/Game';
import type { SkyRig as Sky } from '../../world/skyRig';
import type { Player } from '../../player/Player';
import type { Forest } from '../../world/forest/Forest';

export interface Key { t: number; pos: THREE.Vector3; q: THREE.Quaternion }
export interface Trail {

  from: number;

  color: THREE.Color; alpha: number; inner: number; life: number;
}
export interface Move {
  name: 'slash' | 'backhand' | 'finisher' | 'heavy' | 'pass-left' | 'pass-right';
  keys: [Key, Key, Key];
  windup: number; slashEnd: number; total: number;

  damage: number;

  stagger: number;

  sweep: number;

  kick: { pitch: number; roll: number; fov?: number };

  hitStop: number;

  reach?: number;
  trail: Trail;
}

export interface SwordWorld { game: Game; sky: Sky; player: Player; forest: Forest }


export interface SwordRig {
  sword: THREE.BufferGeometry; arms: THREE.BufferGeometry; tipY: number; baseY: number; tipX?: number; material: THREE.Material;

  extras?: { geometry: THREE.BufferGeometry; material: THREE.Material }[];

  left?: { geometry: THREE.BufferGeometry; material: THREE.Material; pos: THREE.Vector3; q: THREE.Quaternion };
}

export interface SwordArms {

  readonly root: THREE.Object3D;

  play: (move: Move['name'] | 'charge') => void;

  update: (dt: number, s: { speed: number; walkPhase: number; lookVel: THREE.Vector2; camera: THREE.PerspectiveCamera; renderer: DrawingBuffer; holster?: number }) => void;

  blade: (base: THREE.Vector3, tip: THREE.Vector3) => void;

  playLeft?: (name: 'grapple_aim' | 'grapple_fire' | 'grapple_hold' | 'idle') => void;
  setClawVisible?: (visible: boolean) => void;

  setup?: (sky: Sky) => void;

  engineTrail?: boolean;

  glow?: (level: number) => void;
}

export interface SwordFraming { shrink: number; dx: number; dy: number; tilt: number; yaw: number }

export interface SwordMoveSet { rest: Key; charge: Key; sprint: Key; combo: Move[]; heavy: Move }
