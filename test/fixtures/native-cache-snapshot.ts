import { runSnapshot } from './runSnapshot';

/** The native generation cache also keys these runtime/compiler identities.
 * A same-commit fixture may come from a different runner installation. */
export interface NativeCacheSnapshotIdentity {
  readonly node: string;
  readonly platform: string;
  readonly arch: string;
  readonly compiler: string;
}

/** Reuse a native cache corpus only in its original key context. Incompatible
 * optional snapshots take the original cold path, never a rekeyed cache hit. */
export async function runNativeCacheSnapshot<T>(name: string, identity: NativeCacheSnapshotIdentity, compute: () => Promise<T>): Promise<T> {
  const current = JSON.stringify([identity.node, identity.platform, identity.arch, identity.compiler]);
  const snapshot = await runSnapshot(name, async () => ({ nativeCacheIdentity: current, value: await compute() }));
  return snapshot.nativeCacheIdentity === current ? snapshot.value : compute();
}
