import type { AudioData } from '@wildshard/format/audio';
import type { ClientPlan } from '@wildshard/format/clientPlan';
import type { Scope } from '@wildshard/engine/app/scope';
import type { LevelAudioBank } from '@wildshard/engine/audio/levelAudio';
import type { App } from '@wildshard/engine/app/app';
import type { Player } from '@wildshard/engine/player/Player';
import { wind } from '@wildshard/engine/world/steppeWind';
import { ENGINE_MUSIC_STYLE } from '@wildshard/engine/audio/bootAudio';
import { AudioSceneDirector } from '../audio/sceneDirector';

/**
 * AUDIO AU20: an Open Plot on the grid page is a bodyless data cell (no runtime, no declared client page), so no entered
 * hooks run there and its client plan's `audio.scene` never installed: crossing in from a deck shard left the music and
 * ambience buses silent. While the feet stand in such a cell, the grid binds the plot's declared audio scene (its score,
 * bed and loops) to the page's mixer, and drops it on leaving.
 *
 * Where its takes come from: a play-time read (the page cache, else the network) when the feet enter the cell, never in
 * LOAD, so the neighbour the player entered from keeps a DOWNLOAD of only its own audio.
 */

/** One wind observation the plot's `world.updates` audio-scene row feeds its director each frame. */
export interface PlotAudioInput { readonly name: string; readonly field: 'speed' | 'gust' }
/** What an Open Plot's cell plays while the feet stand in it. */
export interface PlotAudioScene { readonly data: AudioData; readonly inputs: readonly PlotAudioInput[] }

/** The plot's declared audio scene, or null when its cell has none the grid can play without an entered runtime: a runtime
 *  shard (its hooks own its audio), no `audio.scene` client feature, a scene in a separate file, or a frame input whose owner
 *  (an arena, the weather rig) exists only inside an entered runtime. */
export function plotAudioScene(source: { readonly runtime: unknown; readonly audio: AudioData }, plan: ClientPlan | undefined): PlotAudioScene | null {
  if (source.runtime !== null || plan === undefined || source.audio.scene === undefined) return null;
  if (!plan.features.some(feature => feature.kind === 'audio.scene')) return null;
  const inputs: PlotAudioInput[] = [];
  for (const feature of plan.features) {
    if (feature.kind !== 'world.updates') continue;
    for (const row of feature.rows) {
      if (row.kind !== 'audio-scene') continue;
      for (const input of row.inputs) {
        if (input.source.kind !== 'wind') return null;
        inputs.push({ name: input.name, field: input.source.field });
      }
    }
  }
  return { data: source.audio, inputs };
}

/** The page owners a plot's scene borrows; tests pass their own. */
export interface PlotAudioPorts {
  /** Bind the declared director to the page's mixer and music for `scope`; returns its frame update. */
  readonly bind: (data: AudioData, scope: Scope) => (dt: number, inputs: Readonly<Record<string, number>>) => void;
  /** Read and decode the plot's level bank (its loops, the score set's stings, the engine title) at play time; the grid
   *  keeps one read per resident cell, so walking its edge back and forth decodes it once. */
  readonly bank: (data: AudioData) => Promise<LevelAudioBank>;
  /** Lend the bank to the page's mixer while `scope` lives; the bank it replaced comes back after. */
  readonly lend: (bank: LevelAudioBank, scope: Scope) => void;
  /** Run `run` every frame while `scope` lives. */
  readonly frame: (run: (dt: number) => void, scope: Scope) => void;
  readonly wind: (field: PlotAudioInput['field']) => number;
  readonly fault: (error: unknown) => void;
}

/** Enter the plot's scene for the life of `scope` (the feet in its cell). The score switches at once; its bank arrives
 *  when read, and a bank read after the feet left is never lent. */
export function enterPlotAudio(scene: PlotAudioScene, scope: Scope, ports: PlotAudioPorts): void {
  if (scope.disposed) return;
  // made before the director binds, so it ends after the director unbinds: the replaced bank returns to the page's own
  // listeners, never to the plot's score and cue player
  const lent = scope.child('plot-audio.bank');
  const update = ports.bind(scene.data, scope);
  ports.frame((dt) => {
    const values: Record<string, number> = {};
    for (const input of scene.inputs) values[input.name] = ports.wind(input.field);
    update(dt, values);
  }, scope);
  const lend = async (): Promise<void> => {
    try {
      const bank = await ports.bank(scene.data);
      if (!lent.disposed) ports.lend(bank, lent);
    } catch (error) { if (!lent.disposed) ports.fault(error); }
  };
  void lend();
}

/** One decode at a time, as the boot's decoder does (WebKit holds no pile of native PCM outputs at once). */
function serialDecode(decode: (bytes: ArrayBuffer) => Promise<AudioBuffer>): (bytes: ArrayBuffer) => Promise<AudioBuffer> {
  let tail: Promise<unknown> = Promise.resolve();
  return (bytes) => {
    const next = tail.then(() => decode(bytes));
    tail = next.catch(() => undefined);
    return next;
  };
}

/** The page's real owners: its mixer and music, the page player, the steppe wind. */
export function pagePlotAudioPorts(app: App, player: Player, instance: string): PlotAudioPorts | null {
  const audio = app.audio;
  if (audio === null) return null;
  return {
    bind: (data, scope) => {
      const director = new AudioSceneDirector(data, player);
      if (director.fieldFiles.length > 0) throw new Error('Plot audio fields need their product reads');
      director.bind(audio, audio.music ?? undefined, undefined, scope);
      return (dt, inputs) => { director.update(dt, inputs); };
    },
    bank: async (data) => {
      const [{ createCatalogueAudio }, { cachedBytes, decodeBytes }] = await Promise.all([import('@wildshard/engine/audio/levelAudio'), import('@wildshard/engine/audio/preload')]);
      const profile = await createCatalogueAudio(data);
      return profile.decode(ENGINE_MUSIC_STYLE, cachedBytes, serialDecode(decodeBytes));
    },
    lend: (bank, scope) => { audio.lendLevelBank(bank, scope); },
    frame: (run, scope) => { app.addContentSystem({ id: `grid.plot-audio.${instance}`, phase: 'update', after: ['engine.player.update'], run }, scope); },
    wind: field => field === 'speed' ? wind.speed : wind.gustAt(player.position.x, player.position.z),
    fault: (error) => { console.warn(`[grid] ${instance} plays no score`, error); },
  };
}
