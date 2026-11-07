import runtimeFixture from './fixtures/quest-runtime.json' with { type: 'json' };
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { Vector3 } from 'three';
import { Scope } from '../src/shared/engine/app/scope';
import { Flags } from '../src/shared/engine/world/interact/flags';
import { QuestState } from '../src/shared/engine/quest/core';
import type { AnimalManager } from '../src/server/engine/entities/AnimalManager';
import type { DeclaredSoundBank } from '../src/client/engine/audio/declaredBank';
import type { ShardContext } from '../src/client/game/plugin/context';
import type { ShardProduct } from '../src/shared/game/shardfile/shardProduct';
import type { QuestPageComposition } from '../src/client/game/quest/pageComposition';
import { publishEntryOwner } from '../src/shared/game/shardfile/entryOwners';
import { publishBoundQuest } from '../src/shared/game/quest/boundState';
import { installDeclaredQuestSpawns, type QuestSpawnCapability } from '../src/client/game/quest/chapterDirector';
import * as spawn from '../src/server/game/population/spawnScript';
import { compileDecisionScripts } from '../src/sharddev/buildDecisionScripts';
import { parseSpawnScript, spawnScriptRegistries, type SpawnScriptRows } from '@wildshard/format/spawnScripts';
import { legacyDouble } from '@wildshard/engine/test/FakeGame';
import type { NetClient } from '../src/client/engine/net/client';
import { wirePage } from '../src/client/game/shardfile/wirePage';
import { spawnCueWord } from '../src/shared/game/shardfile/wirePrompts';

let program: SpawnScriptRows | undefined;
beforeAll(async () => {
  const rows = parseSpawnScript({ step: 'marsh.spawn', roster: 'marsh.animals', seed: 17, maximum: 4, controlState: 'sidestep', bytes: '',
    slots: [{ id: 'bird', handle: 1 }], species: [{ id: 'bird', kind: 'heron', variant: 'reed' }],
    sites: [{ id: 'nest', slot: 'bird', point: [3, 4], face: 'player' }], spawns: [{ id: 'bird', species: 'bird', site: 'nest' }],
    fields: [], flags: ['done:watch'], cues: ['puff', 'sound'], channels: ['count'], moves: [],
    script: { id: 'marsh.spawn', abi: '1.0', side: 'sim', module: `blobs/wasm/${'0'.repeat(64)}.wasm`, source: 'behaviour/marsh.as',
      binding: { shard: true }, pages: 1, onFail: 'hold', tick: 10, on: ['tick'], reads: ['flag'], commands: ['flag', 'cue', 'channel'],
      stateVersion: 1, state: [], params: {}, flags: { done: 'done:watch' }, cues: { puff: 'puff', sound: 'sound' }, channels: { count: 'count' } } });
  const built = await compileDecisionScripts([rows.script], spawnScriptRegistries(rows), new Map([['behaviour/marsh.as',
    "import {Read,Do,Flag,Cue,Channel} from './generated/marshSpawn';\nexport function onTick(dt:f64):void{Do.channel(Channel.count,1);if(!Read.flag(Flag.done)){Do.flag(Flag.done,true);Do.cue(Cue.puff);Do.cue(Cue.sound);}}"]]), { asLineCeiling: 10 });
  const script = built.rows[0], blob = built.blobs[0];
  if (script === undefined || blob === undefined) throw new Error('Missing fixture guest');
  program = parseSpawnScript({ ...rows, script, bytes: btoa(String.fromCodePoint(...blob.bytes)) });
});
const scopes: Scope[] = [];
afterEach(() => { scopes.splice(0).forEach(scope => { scope.dispose(); }); vi.restoreAllMocks(); });
function fixture(omit?: 'quest' | 'animals' | 'sounds') {
  if (program === undefined) throw new Error('Missing compiled fixture guest');
  const source = program, scope = new Scope('marsh.spawns'), flags = new Flags('marsh.spawns', false), events: string[] = [];
  scopes.push(scope);
  const quest = new QuestState({ id: 'marsh.watch', title: 'The watch', completeFlag: 'seen:watch',
    steps: [{ id: 'watch', objective: 'Wait', done: { all: ['done:watch'] } }] }, flags, undefined, scope);
  publishBoundQuest(scope, quest);
  flags.onChange(flag => { if (flag === 'done:watch') events.push('flag'); });
  const rows = { quest: quest.def.id, script: source.step, channel: 1, limit: { phone: 2, desktop: 4 },
    complete: [{ flag: 'done:watch', effects: [{ kind: 'flag', flag: 'done:watch' }, { kind: 'toast', text: 'complete' }] }],
    cues: [{ kind: 'puff', id: 1 }, { kind: 'sound', id: 2, name: 'marsh.call' }],
    puffs: { color: [1, 1, 1], count: 2, height: .5, burst: [1, 2, .4, .6] } };
  const runtime = { ...runtimeFixture, spawns: rows };
  const json = vi.fn(); json.mockResolvedValue(runtime);
  const product = legacyDouble<ShardProduct>({ json }), ctx = legacyDouble<ShardContext>({ scope, product });
  Object.defineProperty(ctx, 'game', { value: { runtime: { world: { sky: { dayNight: { night: 1 } } }, play: {
    hud: { toast: (text: string) => { events.push(text); } }, inventory: { add: () => undefined, take: () => false }, music: { sting: () => undefined },
  } } } });
  const animals = legacyDouble<AnimalManager>({ animals: [] });
  const bank = legacyDouble<DeclaredSoundBank>({ acceptsShot: name => name === 'marsh.call', shot: () => { events.push('sound'); return true; } });
  if (omit !== 'quest') publishEntryOwner(scope, 'quest', 'marsh.quest', legacyDouble<QuestPageComposition>({ flags }));
  if (omit !== 'animals') publishEntryOwner(scope, 'animals', 'marsh.animals', animals);
  if (omit !== 'sounds') publishEntryOwner(scope, 'sounds', 'marsh.sounds', bank);
  const capability: QuestSpawnCapability = { id: 'marsh.spawns', source: 'quests/runtime.json', quest: 'marsh.quest', animals: 'marsh.animals', sounds: 'marsh.sounds' };
  const read = vi.spyOn(spawn, 'readSpawnScript').mockResolvedValue(source);
  return { ctx, scope, quest, flags, events, capability, read, source, json, runtime };
}
for (const kind of ['quest', 'animals', 'sounds'] as const) test(`declared spawn capability refuses a missing ${kind} loan before guest admission`, async () => {
  const f = fixture(kind);
  await expect(installDeclaredQuestSpawns(f.ctx, f.capability)).rejects.toThrow('Missing live entry owner');
  expect(f.read).not.toHaveBeenCalled(); expect(f.events).toEqual([]);
});
// N1: on the wire the server directs the script. This page plays what it says, and shows a finish as its flag rises.
test('on the wire a script\'s cues and its finish show once, and a save\'s flag is no news', async () => {
  const on = Object.getOwnPropertyDescriptor(wirePage, 'on'), settled = vi.spyOn(wirePage, 'settled', 'get').mockReturnValue(false);
  Object.defineProperty(wirePage, 'on', { get: () => true, configurable: true });
  const f = fixture(), views = new Set<Parameters<NetClient['onView']>[0]>();
  wirePage.bind(legacyDouble<NetClient>({ onView: view => { views.add(view); return () => { views.delete(view); }; } }), () => undefined, () => undefined, () => false);
  const say = (args: readonly number[], name = spawnCueWord('marsh.spawn')): void => { for (const view of views) view({ kind: 'view', tick: 0, name, args }); };
  try {
    const result = await installDeclaredQuestSpawns(f.ctx, f.capability);
    expect(f.read, 'no guest on a page on the wire').not.toHaveBeenCalled();
    const shown = (): string[] => f.events.filter(event => event !== 'flag');
    f.flags.set('done:watch'); expect(shown(), 'a save opened with it').toEqual([]);
    f.flags.clear('done:watch'); settled.mockReturnValue(true);
    say([2, 1, 2, 3]); say([1, 4, 5, 6]); say([9, 0, 0, 0]); say([1, 7, 8, 9], spawnCueWord('another'));
    expect(shown()).toEqual(['sound']); expect(result.takePuffs()).toEqual([{ x: 4, y: 5, z: 6 }]); expect(result.takePuffs()).toEqual([]);
    f.flags.set('done:watch'); expect(shown()).toEqual(['sound', 'complete']);
    f.flags.set('done:watch'); expect(shown()).toEqual(['sound', 'complete']);
    f.scope.dispose(); say([2, 0, 0, 0]); expect(views.size).toBe(0);
  } finally { wirePage.unbind(); if (on === undefined) Reflect.deleteProperty(wirePage, 'on'); else Object.defineProperty(wirePage, 'on', on); }
});

test('restored quest flags and v1 envelope stay quiet during capability construction', async () => {
  const f = fixture(); f.flags.restore(['done:watch']);
  const saved: ReturnType<QuestState['snapshot']> = { version: 1, id: f.quest.def.id, started: true, currentId: null };
  f.quest.restore(saved); const flags = f.flags.all;
  const result = await installDeclaredQuestSpawns(f.ctx, f.capability);
  expect(f.quest.snapshot()).toEqual(saved); expect(f.flags.all).toEqual(flags); expect(f.events).toEqual([]);
  result.update(.1, new Vector3()); expect(result.takePuffs()).toEqual([]); expect(f.events).toEqual([]);
});
test('leaving during complete runtime admission constructs no spawn guest', async () => {
  const f = fixture(); let finish: ((value: unknown) => void) | undefined;
  f.json.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const pending = installDeclaredQuestSpawns(f.ctx, f.capability);
  const refusal = expect(pending).rejects.toThrow('Quest left during runtime admission');
  f.scope.dispose();
  if (finish === undefined) throw new Error('Missing pending runtime admission');
  finish(f.runtime); await refusal;
  expect(f.read).not.toHaveBeenCalled(); expect(f.events).toEqual([]);
});

test('a changed product during runtime admission publishes no spawn owner', async () => {
  const f = fixture(); let finish: ((value: unknown) => void) | undefined;
  f.json.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const pending = installDeclaredQuestSpawns(f.ctx, f.capability);
  const refusal = expect(pending).rejects.toThrow('Quest left during runtime admission');
  Object.defineProperty(f.ctx, 'product', { value: legacyDouble<ShardProduct>({}), configurable: true });
  if (finish === undefined) throw new Error('Missing pending runtime admission');
  finish(f.runtime); await refusal;
  expect(f.read).not.toHaveBeenCalled(); expect(f.events).toEqual([]);
});
