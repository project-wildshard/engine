// AUDIO AU20: an Open Plot is a bodyless data cell on the grid page, so no entered hooks install its `audio.scene`; the grid
// binds that declared scene itself while the feet stand in the plot's cell, and reads its bank at play time, never in LOAD.
// oxlint-disable-next-line import/no-nodejs-modules -- Read the pinned products' cooked sections.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import type { AudioData } from '@wildshard/format/audio';
import type { ClientPlan } from '@wildshard/format/clientPlan';
import type { LevelAudioBank } from '../src/client/engine/audio/levelAudio';
import { Scope } from '../src/shared/engine/app/scope';
import { enterPlotAudio, plotAudioScene, type PlotAudioPorts } from '../src/client/game/grid/plotAudio';

const section = <T>(shard: string, name: string, key?: string): T => {
  const value: unknown = JSON.parse(readFileSync(`out/${shard}/sections/${name}.json`, 'utf8'));
  return (key === undefined ? value : (value as Record<string, unknown>)[key]) as T;
};
// The pinned products (`pnpm pins`); every Open Plot on the grid is a data cell.
const plots = existsSync('out') ? readdirSync('out').filter(shard => shard.startsWith('open-plot-') && existsSync(`out/${shard}/sections/client/plan.json`)) : [];

test.skipIf(plots.length === 0)('every pinned Open Plot declares an audio scene the grid can play in its cell', () => {
  for (const shard of plots) {
    const audio = section<AudioData>(shard, 'audio/audio', 'audio'), plan = section<ClientPlan>(shard, 'client/plan');
    const scene = plotAudioScene({ runtime: null, audio }, plan);
    expect(scene, shard).not.toBeNull();
    expect(scene?.data.music?.id, shard).toBe(shard.slice('open-plot-'.length));
    expect(scene?.inputs, shard).toEqual([{ name: 'wind', field: 'speed' }]);
  }
});

const audio = { scene: {}, music: { id: 'saltwind-lighthouse' } } as unknown as AudioData;
const plan = (inputs: unknown[] = [{ name: 'wind', source: { kind: 'wind', field: 'speed' } }]): ClientPlan => ({ version: 1, features: [
  { kind: 'audio.scene' }, { kind: 'world.updates', rows: [{ kind: 'audio-scene', system: 'plot.audio', after: [], before: [], inputs }] },
] } as unknown as ClientPlan);

test('a runtime shard, a plan without the scene feature, or a runtime-only frame input plays nothing on its own', () => {
  expect(plotAudioScene({ runtime: null, audio }, plan())).not.toBeNull();
  expect(plotAudioScene({ runtime: { binds: [] }, audio }, plan())).toBeNull();
  expect(plotAudioScene({ runtime: null, audio }, undefined)).toBeNull();
  expect(plotAudioScene({ runtime: null, audio }, { version: 1, features: [] } as unknown as ClientPlan)).toBeNull();
  expect(plotAudioScene({ runtime: null, audio: { ...audio, scene: undefined } as unknown as AudioData }, plan())).toBeNull();
  expect(plotAudioScene({ runtime: null, audio }, plan([{ name: 'inside', source: { kind: 'arena', field: 'inside', owner: 'a' } }]))).toBeNull();
});

const fakePorts = (): { ports: PlotAudioPorts; log: string[]; frames: ((dt: number) => void)[]; decoded: (bank: LevelAudioBank) => void } => {
  const log: string[] = [], frames: ((dt: number) => void)[] = [];
  let decoded: (bank: LevelAudioBank) => void = () => undefined;
  const ports: PlotAudioPorts = {
    bind: (data, scope) => { log.push(`bind ${String(data.music?.id)}`); scope.onDispose(() => { log.push('unbind'); }); return (dt, inputs) => { log.push(`update ${dt} ${JSON.stringify(inputs)}`); }; },
    bank: () => new Promise((resolve) => { decoded = resolve; }),
    lend: (_bank, scope) => { log.push('lend'); scope.onDispose(() => { log.push('return bank'); }); },
    frame: (run, scope) => { frames.push(run); scope.onDispose(() => { frames.splice(frames.indexOf(run), 1); }); },
    wind: field => (field === 'speed' ? 7 : 0.5),
    fault: (error) => { log.push(`fault ${String(error)}`); },
  };
  return { ports, log, frames, decoded: bank => { decoded(bank); } };
};
const bank = { title: undefined, score: { slots: new Map(), stings: new Map() }, cues: { loops: new Map(), shots: new Map() } } satisfies LevelAudioBank;

test('entering the plot binds its score at once, feeds its wind each frame and lends its bank once read; leaving undoes all', async () => {
  const scene = plotAudioScene({ runtime: null, audio }, plan());
  if (scene === null) throw new Error('scene');
  const { ports, log, frames, decoded } = fakePorts(), cell = new Scope('plot-cell');
  enterPlotAudio(scene, cell, ports);
  expect(log).toEqual(['bind saltwind-lighthouse']);
  frames[0]?.(0.016);
  expect(log.at(-1)).toBe('update 0.016 {"wind":7}');
  decoded(bank); await Promise.resolve(); await Promise.resolve();
  expect(log.at(-1)).toBe('lend');
  cell.dispose();
  // the director unbinds first, so the returned bank never reaches the plot's own score
  expect(log.slice(-2)).toEqual(['unbind', 'return bank']);
  expect(frames).toEqual([]);
});

test('a bank read after the feet left the plot is never lent', async () => {
  const scene = plotAudioScene({ runtime: null, audio }, plan());
  if (scene === null) throw new Error('scene');
  const { ports, log, decoded } = fakePorts(), cell = new Scope('plot-cell');
  enterPlotAudio(scene, cell, ports);
  cell.dispose();
  decoded(bank); await Promise.resolve(); await Promise.resolve();
  expect(log).toEqual(['bind saltwind-lighthouse', 'unbind']);
});
