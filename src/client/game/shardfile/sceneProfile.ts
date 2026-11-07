import type { Shardfile } from '@wildshard/format/shardSchema';

const profiles = new WeakMap<object, readonly string[]>();
/** The trusted estimate records the exact world profile before any geometry is decoded. */
export function recordSceneProfile(source: Shardfile, files: readonly string[]): void {
  profiles.set(source.files, [...files]);
}
/** A changed profile needs fresh admission; it cannot allocate against an older lower estimate. */
export function assertSceneProfile(source: Shardfile, files: readonly string[]): void {
  const admitted = profiles.get(source.files);
  if (admitted !== undefined && (admitted.length !== files.length || admitted.some((file, index) => file !== files[index]))) throw new Error('World profile changed after memory admission; reload to admit the selected profile');
}
