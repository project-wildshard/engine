import type { EngineProbe, ProbeWorld } from '../../src/client/engine/debug/probe';

/** The public probe exposes authored handles on shard, never on raw Game. This
 * reader is self-contained so the phone harness can evaluate the same contract. */
export function eliteEntryProbeFrame(probe: {
  readonly app: Pick<EngineProbe['app'], 'state'>;
  readonly world: Pick<ProbeWorld, 'game'> | undefined;
  readonly shard: EngineProbe['shard'];
}): { ids: string[]; frames: number; calls: number } {
  const world = probe.world;
  if (probe.app.state !== 'play' || world === undefined) throw new Error('No entered play world');
  const { frame: frames, calls } = world.game.renderer.info.render;
  if (frames <= 0 || calls <= 0) throw new Error('No rendered play frame');
  const owner = probe.shard['nalati.elites'];
  if (owner === null || typeof owner !== 'object' || !('scripts' in owner)) throw new Error('Missing authored elite exposure');
  const entry: unknown = owner;
  if (entry === null || typeof entry !== 'object' || !('scripts' in entry) || !Array.isArray(entry.scripts)) throw new Error('Missing entered elite controllers');
  const scripts: readonly unknown[] = entry.scripts;
  const ids = scripts.map(script => {
    if (script === null || typeof script !== 'object' || !('def' in script)) throw new Error('Invalid elite controller exposure');
    const definition: unknown = script.def;
    if (definition === null || typeof definition !== 'object' || !('id' in definition) || typeof definition.id !== 'string') throw new Error('Missing elite controller identity');
    return definition.id;
  });
  return { ids, frames, calls };
}
