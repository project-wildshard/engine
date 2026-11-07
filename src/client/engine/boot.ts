import { app } from './app/runtime';
import type { LevelContext, LevelHooks } from '../../server/engine/level/context';
import type { LevelDriver } from './level/load';
import type { LevelSpec } from '../../shared/engine/level/spec';
import type { Scope } from '../../shared/engine/app/scope';

export type LevelBoundary = 'world' | 'kit' | 'loadout' | 'play' | 'finish';
export type LevelSequence<T> = AsyncGenerator<LevelBoundary, T, LevelContext | undefined>;

/** The staged mechanisms are generic; the composition root supplies content and hook adapters. */
export function levelSequenceDriver<T>(sequence: LevelSequence<T>, scope: Scope,
  progress: () => LevelContext['progress'], dispose: () => void): { driver: LevelDriver; result: () => T } {
  let completed: [] | [T] = [];
  const advance = async (ctx: LevelContext, boundary: LevelBoundary): Promise<void> => {
    const next = await sequence.next(ctx);
    if (next.done || next.value !== boundary) throw new Error(`Level boot expected the ${boundary} boundary`);
  };
  return {
    driver: {
      scope: () => scope, progress,
      data: (_spec, ctx) => advance(ctx, 'world'),
      world: (_spec, ctx) => advance(ctx, 'kit'),
      kit: (_spec, ctx) => advance(ctx, 'loadout'),
      loadout: (_spec, ctx) => advance(ctx, 'play'),
      play: (_spec, ctx) => advance(ctx, 'finish'),
      finish: async (_spec, ctx) => {
        const next = await sequence.next(ctx);
        if (!next.done) throw new Error('Level boot did not finish after the play hook');
        completed = [next.value];
      },
      dispose,
    },
    result: () => {
      if (completed.length === 0) throw new Error('Level boot has not finished');
      return completed[0];
    },
  };
}

export async function bootLevel<T>(spec: LevelSpec, opts: {
  sequence: LevelSequence<T>; scope: Scope; progress: () => LevelContext['progress'];
  dispose: () => void; hooks: LevelHooks; afterData?: (spec: LevelSpec) => void;
}): Promise<T> {
  const staged = levelSequenceDriver(opts.sequence, opts.scope, opts.progress, opts.dispose);
  app.levelDriver = { ...staged.driver, data: async (level, ctx) => {
    await staged.driver.data(level, ctx);
    opts.afterData?.(level);
  } };
  await app.loadLevel(spec, opts.hooks);
  return staged.result();
}
