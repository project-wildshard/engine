/** The shared pond tessellation; pure so public manifest imports cannot load the world. */
export function pondGrid(pond: { x: number; z: number; r: number }): { half: number; segs: number; cell: number; x0: number; z0: number } {
  const half = pond.r + 15, segs = 128;
  return { half, segs, cell: (half * 2) / segs, x0: pond.x - half, z0: pond.z - half };
}
