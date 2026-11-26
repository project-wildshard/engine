/** Verify local tables after a completed, independently verified generation phase. */
export function sourceTablesCached(root: string, step: 'shards-before' | 'boot' | 'shards-after', run: () => unknown): Promise<boolean>;
