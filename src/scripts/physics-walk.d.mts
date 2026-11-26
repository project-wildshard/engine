export interface PhysicsWalkLeg {
  readonly start: { readonly x: number; readonly z: number; readonly y?: number; readonly yaw: number; readonly hover?: boolean };
  readonly waypoints: readonly { readonly x: number; readonly z: number; readonly jump?: boolean | number; readonly jumpAt?: number }[];
  readonly timeout?: number;
  readonly inside?: { readonly x0: number; readonly x1: number; readonly z0: number; readonly z1: number; readonly floor: number };
}
export interface PhysicsWalkResult {
  readonly trace: number[][];
  readonly stuck: { readonly wp: number; readonly x: number; readonly y: number; readonly z: number;
    readonly motor: unknown; readonly water: unknown; readonly grid?: unknown; readonly ground: string | null }[];
  readonly out: number;
  readonly complete: boolean;
  readonly timedOut: boolean;
  readonly wall: number;
}
export function walkPhysicsLeg(leg: PhysicsWalkLeg): Promise<PhysicsWalkResult>;
