import type { Scope } from '@wildshard/engine/app/scope';
import type { LevelSpec } from '@wildshard/engine/level/spec';
import type { LevelFrameOptions } from '@wildshard/engine/level/frame';
import type { LookStrategy } from '@wildshard/engine/render/look';

/** Independent product-backed inputs overlap; neither publishes a regional frame.
 * The look is owned as soon as it resolves, including when navigation later refuses.
 * Optional material preparation starts on that look without waiting for navigation;
 * both still finish before the caller can publish terrain or collision. */
export async function prepareRegionalInputs(level: Pick<LevelSpec, 'look'>, owner: Scope,
  navigation: (() => Promise<LevelFrameOptions['navmesh']>) | undefined,
  prepareLook?: (look: LookStrategy | null) => Promise<void>): Promise<{
    readonly navmesh: LevelFrameOptions['navmesh']; readonly look: LookStrategy | null;
  }> {
  const live = (): void => { if (owner.disposed || owner.disposing) throw new Error('Regional world left while loading its inputs'); };
  live();
  const navmesh = async (): Promise<LevelFrameOptions['navmesh']> => {
    const result = navigation === undefined ? null : await navigation(); return result;
  };
  const look = async (): Promise<LookStrategy | null> => {
    const result = level.look === undefined ? null : await level.look();
    if (owner.disposed || owner.disposing) { result?.dispose?.(); live(); }
    owner.onDispose(() => { result?.dispose?.(); });
    await prepareLook?.(result);
    live();
    return result;
  };
  const [nav, appearance] = await Promise.allSettled([navmesh(), look()]);
  // Preserve the original navigation-first failure precedence and drain both.
  if (nav.status === 'rejected') throw nav.reason;
  if (appearance.status === 'rejected') throw appearance.reason;
  live();
  return { navmesh: nav.value, look: appearance.value };
}
