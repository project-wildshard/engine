// three ships meshoptimizer's simplifier (wasm) without types: the slice BlenderIsland.ts uses (E117's far palms).
declare module 'three/examples/jsm/libs/meshopt_simplifier.module.js' {
  type SimplifyFlag = 'LockBorder' | 'Sparse' | 'ErrorAbsolute' | 'Prune' | 'Regularize' | 'Permissive' | 'RegularizeLight';
  export const MeshoptSimplifier: {
    readonly ready: Promise<void>;
    readonly supported: boolean;
    /** → [the simplified index buffer, the relative error it reached] */
    simplify: (indices: Uint32Array, positions: Float32Array, stride: number, targetIndexCount: number, targetError: number, flags?: SimplifyFlag[]) => [Uint32Array, number];
  };
}
