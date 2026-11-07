
import { SHARD_API } from '../../../shared/game/shard/api';
import type { ShardManifest } from './manifest';
import type { Ktx2Table } from '@wildshard/engine/boot/gpuFiles';
import type { LoadFailure } from '@wildshard/engine/core/errorReport';
import { loadingStage } from '@wildshard/engine/boot/waits';

const tables = new WeakMap<ShardManifest, Promise<void>>();

/** Install optional shard-owned mappings before any boot manifest or asset loader reads them. */
export function prepareShardAssets(manifest: ShardManifest, register: (table: Ktx2Table) => void): Promise<void> {
  let ready = tables.get(manifest);
  if (ready === undefined) {
    ready = manifest.ktx2 === undefined ? Promise.resolve() : manifest.ktx2().then((module) => { register(module.GPU_FILES); return undefined; });
    tables.set(manifest, ready);
    void ready.catch(() => { tables.delete(manifest); });
  }
  return ready;
}

export type LoadStage = <T>(name: string, work: () => T | Promise<T>) => Promise<T>;
export interface ShardLoadFailure extends LoadFailure { readonly shard: string }
export interface ShardLoadServices {
  readonly build: string;
  readonly dispose: () => void | Promise<void>;
  readonly report: (failure: LoadFailure) => Promise<unknown>;
  readonly show: (failure: LoadFailure) => unknown;
}

export class ShardLoadError extends Error {
  readonly stage: string;
  constructor(stage: string, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = 'ShardLoadError';
    this.stage = stage;
    if (cause instanceof Error && cause.stack !== undefined) this.stack = cause.stack;
  }
}

/** The innermost failing stage wins, including promises started in parallel with world construction. */
export const loadStage: LoadStage = async (name, work) => {
  try { return await loadingStage(name, work); }
  catch (error) { throw error instanceof ShardLoadError ? error : new ShardLoadError(name, error); }
};

/** API refusal and every awaited build failure share one dispose → report → shell-screen path. */
export async function runShardLoad<T>(manifest: { readonly api: number; readonly slug: string; readonly name: string }, work: (stage: LoadStage) => Promise<T>, services: ShardLoadServices): Promise<T> {
  try {
    if (manifest.api !== SHARD_API) throw new ShardLoadError('manifest.api', new Error(`${manifest.name}: shard API ${manifest.api}; engine supports API ${SHARD_API}`));
    return await work(loadStage);
  } catch (error) {
    const stage = error instanceof ShardLoadError ? error.stage : 'build';
    const failure: ShardLoadFailure = {
      kind: 'shard-load', shard: manifest.slug, name: manifest.name, build: services.build,
      stage,
      context: { kind: 'shard-load', shard: manifest.slug, build: services.build, stage },
      tags: { system: 'shard-load', shard: manifest.slug, build: services.build, bootStage: stage, fatal: true },
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack ?? '' : String(error),
    };
    try { await services.dispose(); } catch (disposeError) { console.warn('[load] level disposal failed', disposeError); }
    void services.report(failure).catch((reportFailure: unknown) => { console.warn('[load] error reporting failed', reportFailure); });
    services.show(failure);
    throw error;
  }
}

/** Legacy hook bridge until S1–S4 move these hooks into plugins. Restore authored functions after boot. */
export async function withShardHooks<T>(manifest: Pick<ShardManifest, 'render' | 'sword' | 'roster' | 'fieldModels' | 'ground'>, stage: LoadStage, work: () => Promise<T>): Promise<T> {
  const prefetched: LoadStage = (name, job) => {
    const pending = stage(name, job);
    void pending.catch(() => undefined);
    return pending;
  };
  const { render, sword, roster, fieldModels } = manifest;
  const structures = typeof manifest.ground.structures === 'object' ? manifest.ground.structures : undefined;
  const structureBuild = structures?.build;
  if (render !== undefined) manifest.render = (product) => prefetched('render', () => render(product));
  if (sword !== undefined) manifest.sword = () => prefetched('sword', sword);
  if (roster !== undefined) manifest.roster = (product) => prefetched('roster', () => roster(product));
  if (fieldModels !== undefined) manifest.fieldModels = () => prefetched('fieldModels', fieldModels);
  if (structures !== undefined && structureBuild !== undefined) structures.build = () => stage('structures', async () => {
    const builder = await structureBuild();
    return { ...builder, build: (ctx) => stage('structures.build', () => builder.build(ctx)) };
  });
  try { return await work(); }
  finally {
    if (render !== undefined) manifest.render = render;
    if (sword !== undefined) manifest.sword = sword;
    if (roster !== undefined) manifest.roster = roster;
    if (fieldModels !== undefined) manifest.fieldModels = fieldModels;
    if (structures !== undefined && structureBuild !== undefined) structures.build = structureBuild;
  }
}
