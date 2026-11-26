export const RECORDED_BAKES: readonly { file: string; script: string; bake: string }[];
export function isRecordedBake(file: string): boolean;
export function bakeOutcome(text: string): string;
export function refreshBakeInputs(root: string): Promise<Record<string, string>>;

export {bakeInputHashes,InputHashMemo} from './input-hash-memo.mjs';
