/** Validate fixed world poses, with radians and complete shard coverage. */
export function frameFloorStanding(input: unknown, shards: readonly string[]): Record<string, {
  name: string; x: number; y: number; z: number; yaw: number; pitch: number;
}[]>;
