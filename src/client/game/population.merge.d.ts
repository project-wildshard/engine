import type { Vector3 } from 'three';

declare module '@wildshard/engine/events/maps' {
  interface EventMap {
    'creature.knockdown': Pick<Vector3,'x' | 'z'> & { strength: number };
    'creature.sound': { cue: string; x: number; y: number; z: number };
  }
}
