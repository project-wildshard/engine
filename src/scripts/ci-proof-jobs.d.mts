export const PROOF_SHAPES: Readonly<Record<string, readonly {jobs: readonly string[]; tests: boolean}[]>>;
export const PACKED_STEP: string;
export function provesCode(workflow: string, jobs: readonly unknown[]): boolean;
