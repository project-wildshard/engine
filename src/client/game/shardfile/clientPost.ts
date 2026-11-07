/**
 * A shard's own post stack on the client (SHARD-PLATFORM SF59 step 4, G158): the admitted `look.post` passes compiled by the
 * classic graph back-end into composer passes (`ScenePostGraphCompiler.compilePass`, plus one normal pre-pass when a pass
 * reads `sceneNormal`), inserted before the engine's colour pass (so the platform's grade, tone mapping and anti-aliasing
 * still run after them) and removed with the scope.
 *
 * - **Default off:** the stack is built only while Settings ▸ Debug ▸ Look ▸ "Graph materials" is on (the row the graph
 *   materials already wait behind for a physical-iPhone reading); otherwise nothing loads and the frame is unchanged.
 * - **The owner weight:** `weight(w)` fades every pass over the scene (0 disables them, so a stack outside its cell costs
 *   nothing); standalone it stays 1, in the grid the frame hands it its cell's owner weight.
 * - **Bound params move:** a pass's day and state bindings are fed like the material graphs' (`graphParamFeeds`): the
 *   frame owner's hour samples the shard's own look keys, a state binding reads the live public state (the field's
 *   declared default until `bind` hands the source); `tick` moves them each frame.
 */
import type { Camera, Scene } from 'three';
import type { EffectComposer, Pass } from 'postprocessing';
import { validateGraph } from '@wildshard/format/materialGraph';
import type { ScenePostGraphCompiler, ScenePostPass } from '@wildshard/engine/render/graphBackend';
import type { Scope } from '@wildshard/engine/app/scope';
import { graphBindingSources, graphFileJson } from '@wildshard/format/materials';
import { graphParamFeeds, type GraphSources } from './clientGraphs';
import type { Shardfile } from '@wildshard/format/shardSchema';

/** What the client made of a shard's post stack. */
export interface ClientPost {
  /** the stack's owner weight (0 … 1) */
  readonly weight: (w: number) => void;
  /** the readout: passes inserted, the weight last set, whether a normal pre-pass draws */
  readonly state: () => { readonly passes: number; readonly weight: number; readonly normal: boolean };
  /** insert the passes once the page's composer exists (false: not built yet, call again next frame) */
  readonly install: () => boolean;
  /** move the bound params (the shard's own day clock advances by `dt` until a frame owner's hour is bound) */
  readonly tick: (dt: number) => void;
  /** hand the bound params their live sources: the frame owner's hour and the shard's public state */
  readonly bind: (sources: GraphSources) => void;
  /** how many bound params the stack feeds */
  readonly bound: () => number;
}

/** The composer's first effect pass (the engine's colour pass and what follows): a shard's passes go before it. */
function insertAt(composer: Pick<EffectComposer, 'passes'>): number {
  const index = composer.passes.findIndex((pass) => pass.name === 'EffectPass');
  return index === -1 ? composer.passes.length : index;
}

/**
 * Build `shard`'s post stack for the page's composer (null: no stack, or the Debug row off); `install` inserts it once
 * `composer()` stops throwing (the page builds its composer after the world stage). `scene` / `camera` are what the
 * composer's render pass draws (the normal pre-pass draws them again).
 */
export async function clientPostStack(shard: Pick<Shardfile, 'identity' | 'look' | 'state'>, assets: ReadonlyMap<string, Uint8Array>, page: { readonly compiler: () => Promise<ScenePostGraphCompiler>; readonly composer: () => Pick<EffectComposer, 'passes' | 'addPass' | 'removePass'>; readonly scene: Scene; readonly camera: Camera }, scope: Scope, options: { readonly enabled: boolean }): Promise<ClientPost | null> {
  const stack = shard.look.post ?? [];
  if (!options.enabled || stack.length === 0) return null;
  const compiler = await page.compiler();
  if (scope.disposed) throw new Error('Post stack scope unloaded during the graph compiler load');
  const { day, state } = graphBindingSources(shard);
  const graphs = stack.map((pass, index) => {
    const checked = validateGraph('graph' in pass ? pass.graph : graphFileJson(pass.file, (hash) => assets.get(hash)), { dayKeys: [...day.keys()], stateFields: state });
    if (!checked.ok || checked.graph.kind !== 'post') throw new Error(`post[${index}] refused: ${checked.ok ? 'not a post graph' : checked.errors.join('; ')}`);
    return checked;
  });
  const normal = graphs.some((checked) => checked.inputs.normal) ? compiler.normalPrepass(page.scene, page.camera) : null;
  // the scene and depth inputs are unbound until the first frame moves them to the composer's own buffers
  // (`ClassicPostPass.render`, `setDepthTexture`)
  const passes: Pass[] = [];
  const feeds = graphParamFeeds(shard);
  const posts: ScenePostPass[] = graphs.map((checked) => {
    const compiled = compiler.compilePass(checked.graph, {
      dayKeys: [...day.keys()], stateFields: state, validated: checked,
      camera: page.camera, depth: checked.inputs.depth, normal: normal === null ? null : normal.texture,
    });
    feeds.attach(compiled.graph, checked.graph.params);
    return compiled.pass;
  });
  let weight = 1, installed: Pick<EffectComposer, 'passes' | 'addPass' | 'removePass'> | null = null;
  scope.onDispose(() => {
    for (const pass of [...(normal === null ? [] : [normal]), ...posts]) { installed?.removePass(pass); pass.dispose(); }
  });
  return {
    install: () => {
      if (installed !== null) return true;
      let composer: Pick<EffectComposer, 'passes' | 'addPass' | 'removePass'>;
      try { composer = page.composer(); } catch { return false; } // not built yet: next frame
      let at = insertAt(composer);
      if (normal !== null) { composer.addPass(normal, at); passes.push(normal); at++; }
      for (const pass of posts) { composer.addPass(pass, at); passes.push(pass); at++; }
      installed = composer;
      return true;
    },
    weight: (w) => { weight = Math.min(1, Math.max(0, w)); for (const pass of posts) pass.setWeight(weight); if (normal !== null) normal.enabled = weight > 0; },
    state: () => ({ passes: passes.length, weight, normal: normal !== null }),
    tick: feeds.tick, bind: feeds.bind, bound: feeds.count,
  };
}
