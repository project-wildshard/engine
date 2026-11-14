// @vitest-environment happy-dom
import { expect, test, vi } from 'vitest';
import {fixtureFolderFile,fixtureJsonCheck} from './fixtures/folderFile';
import * as v from 'valibot';
import { Group, Scene, Mesh, MeshBasicMaterial, BufferGeometry } from 'three';
import { Scope } from '../src/shared/engine/app/scope';
import { legacyDouble } from '@wildshard/engine/test/FakeGame';
import type { ShardContext } from '../src/client/game/plugin/context';
import type { ForestWeatherRig } from '../src/client/game/weather/forest';
import { installClientForestWeather } from '../src/client/game/shardfile/clientForestPage';
import { CLIENT_FEATURES } from '../src/client/game/shardfile/clientPlan';
import { parseClientPlan } from '@wildshard/format/clientPlan';
import { WorldAssemblySchema } from '@wildshard/format/worldAssembly';
import { publishEntryOwner, entryOwner, lendEntryOwner } from '../src/shared/game/shardfile/entryOwners';
import { createShardFolder } from '../src/shared/game/shardfile/shardFolder';
import { emptyShardfile } from '../src/shared/host/author';
import { ClientChannels } from '../src/sharddev/clientChannels';
import { parseClientChannels } from '@wildshard/format/clientChannels';
import { DayCycle } from '../src/shared/engine/world/dayCycle';
import { lendLooks } from '../src/client/game/shardfile/lentLooks';
import { Events } from '../src/shared/engine/events/events';
import type { WeatherHUD } from '../src/client/engine/ui/HUD';

const row = { kind: 'weather.forest', owner: 'meadow.weather', file: 'world/forest-weather.json' } as const;
const policy = { files: { program: 'weather/program.json' }, mode: 'live', debug: 'meadow.weather', heldPhase: 0,
  system: { id: 'meadow.weather', after: [], before: [] } };
function fixture(parent?: Scope) {
  const scope = parent?.child('world-weather') ?? new Scope('world-weather'), trace: string[] = [];
  type Runtime = NonNullable<ShardContext['game']['runtime']>;
  const sky = legacyDouble<NonNullable<Runtime['world']>['sky']>({}), root = new Scene();
  const game = legacyDouble<NonNullable<Runtime['world']>['game']>({ scene: root, levelScope: scope });
  const world = legacyDouble<NonNullable<Runtime['world']>>({ game, sky }), runtime = legacyDouble<Runtime>({ world });
  let settle: (value: unknown) => void = () => { throw new Error('Missing read resolver'); };
  const result = new Promise<unknown>(resolve => { settle = resolve; });
  const source = emptyShardfile({ slug: 'weather-fixture', name: 'Weather fixture', author: 'Fixture', revision: 1, seed: 1 });
  const product = createShardFolder({ slug: source.identity.slug, revision: 1, shardfile: source, sections: new Map(),
    files: new Map([[row.file, fixtureFolderFile(row.file, { hash: 'weather', url: 'weather' })]]), jsonCheck: fixtureJsonCheck, read: async () => { trace.push('read weather'); return new TextEncoder().encode(JSON.stringify(await result)); } });
  const ctx = legacyDouble<ShardContext>({ scope, product, game: legacyDouble<ShardContext['game']>({ runtime }) });
  return { scope, ctx, runtime, world, product, trace, settle };
}


const install = (ctx: ShardContext): Promise<void> => installClientForestWeather(ctx, row.file, undefined, row.owner);

test('declared weather HUD binds before weather reads and keeps the original play owner', async () => {
  const f = clockedFixture(), events = new Events(), setWeather = vi.fn<(state: WeatherHUD) => void>(() => undefined);
  f.runtime.play = legacyDouble<NonNullable<typeof f.runtime.play>>({hud: legacyDouble<NonNullable<typeof f.runtime.play>['hud']>({setWeather})});
  const original = f.runtime.play;
  const on: ShardContext['on'] = (name, run) => { f.trace.push('bind HUD'); events.on(name, run, f.scope); };
  Object.assign(f.ctx, {on});
  const weather = {chip: null, getLow: true};
  try {
    await CLIENT_FEATURES['weather.forest'].install(f.ctx, {...row, hud: true}, f.scope);
    expect(f.trace[0]).toBe('bind HUD');
    events.emit('weather.changed', weather); events.flush('update'); expect(setWeather).toHaveBeenCalledExactlyOnceWith(weather);
    f.runtime.play = null;
    events.emit('weather.changed', weather); expect(() => events.flush('update')).toThrow('HUD owner changed');
    expect(setWeather).toHaveBeenCalledTimes(1);
    f.runtime.play = original; f.scope.dispose();
    events.emit('weather.changed', weather); events.flush('update'); expect(setWeather).toHaveBeenCalledTimes(1);
  } finally { f.close(); }
});

test('weather is the existing strict play feature and the assembly stage is retired', () => {
  const rows = { version: 1, features: [row] };
  const parsed: unknown = parseClientPlan(rows);
  expect(parsed).toEqual(rows);
  for (const extra of [{ phase: 'world' }, { run: 'install' }, { page: ['path'] }, { owner: '../weather' }])
    expect(() => parseClientPlan({ version: 1, features: [{ ...row, ...extra }] })).toThrow();
  expect(v.safeParse(WorldAssemblySchema, { stages: [{ kind: 'weather', id: row.owner, file: row.file }] }).success).toBe(false);
  expect([CLIENT_FEATURES['weather.forest'].phase, CLIENT_FEATURES['weather.forest'].rank]).toEqual(['play', 40]);
});

test('weather publication refuses a missing native world before the first file read', async () => {
  const f = fixture();
  try {
    f.runtime.world = null;
    await expect(install(f.ctx)).rejects.toThrow('Weather requires its world'); expect(f.trace).toEqual([]);
  } finally { f.scope.dispose(); }
});

test('the held feature read fences every original context, product and native owner', async () => {
  for (const changed of ['product', 'runtime', 'world', 'sky', 'scene', 'scope', 'native']) {
    const f = fixture(), foreign = new Scope('foreign-weather'), work = install(f.ctx);
    try {
      expect(f.trace).toEqual(['read weather']);
      if (changed === 'product') Object.assign(f.ctx, { product: { ...f.product } });
      else if (changed === 'runtime') Object.assign(f.ctx.game, { runtime: { ...f.runtime } });
      else if (changed === 'world') f.runtime.world = { ...f.world };
      else if (changed === 'sky') Object.assign(f.world, { sky: {} });
      else if (changed === 'scene') Object.assign(f.world.game, { scene: new Scene() });
      else if (changed === 'scope') Object.assign(f.ctx, { scope: foreign });
      else Object.assign(f.world.game, { levelScope: foreign });
      f.settle(policy); await expect(work).rejects.toThrow('owner left or changed');
      expect(() => entryOwner(f.scope, 'world-weather', row.owner)).toThrow('Missing live entry owner');
    } finally { f.scope.dispose(); foreign.dispose(); }
  }
});

test('ancestor retirement during the held weather read publishes no owner or progress', async () => {
  const parent = new Scope('weather-parent'), f = fixture(parent), work = install(f.ctx);
  parent.onDispose(() => undefined); const retirement = parent.disposeSteps(); retirement.next();
  try {
    expect(f.scope.disposing).toBe(true); f.settle(policy);
    await expect(work).rejects.toThrow('owner left or changed'); expect(f.trace).toEqual(['read weather']);
  } finally { for (const step of retirement) void step; parent.dispose(); }
});

test('an explicitly published weather row requires a clock without extra progress', async () => {
  const f = fixture();
  try {
    const work = install(f.ctx); f.settle(policy);
    await expect(work).rejects.toThrow('original clocked sky'); expect(f.trace).toEqual(['read weather']);
    expect(() => entryOwner(f.scope, 'world-weather', row.owner)).toThrow('Missing live entry owner');
  } finally { f.scope.dispose(); }
});

test('the typed loan retains original weather and never disposes borrowed services', () => {
  const construction = new Scope('weather-construction'), entered = construction.child('weather-entered'), setMode = vi.fn((): void => undefined);
  const rig = legacyDouble<ForestWeatherRig>({ group: new Group(), setMode });
  try {
    publishEntryOwner(construction, 'world-weather', row.owner, rig); lendEntryOwner(entered, construction, 'world-weather', row.owner);
    expect(entryOwner(entered, 'world-weather', row.owner)).toBe(rig); entered.dispose();
    expect(entryOwner(construction, 'world-weather', row.owner)).toBe(rig); expect(setMode).not.toHaveBeenCalled();
    const next = construction.child('weather-reentered'); lendEntryOwner(next, construction, 'world-weather', row.owner);
    construction.dispose(); expect(() => entryOwner(next, 'world-weather', row.owner)).toThrow('ended'); expect(setMode).not.toHaveBeenCalled();
  } finally { construction.dispose(); }
});

function clockedFixture(hold?: 'sky' | 'program', parent?: Scope, nativeOwner?: Scope) {
  const scope = parent?.child('clocked-weather') ?? new Scope('clocked-weather'), trace: string[] = [], registrations: string[] = [], exposed = new Map<string, unknown>();
  const schema = { keyColor: 'colour', keyIntensity: 'number', shadeTint: 'colour', rimColor: 'colour', hemiSky: 'colour', hemiGround: 'colour',
    hemiIntensity: 'number', envIntensity: 'number', fogColor: 'colour', fogSunColor: 'colour', fogDist: 'number', fogHeightDensity: 'number',
    cloudSun: 'colour', cloudLight: 'colour', planetLight: 'colour', planetOpacity: 'number', disc: 'number', moon: 'number', saturation: 'number' };
  const initial = Object.fromEntries(Object.entries(schema).map(([name, kind]) => [name, kind === 'colour' ? [1, 1, 1] : 1]));
  const shape = new BufferGeometry(), skyFile = { shapes: { dome: shape.toJSON() }, sky: { schema, day: { fog: [1, 1, 1], shade: [1, 1, 1], rim: [1, 1, 1], sunI: 1 }, initial } };
  const clock = { units: 'hour', start: 12, sun: { maxElevation: 60, azimuthOffset: 0 }, schedule: [{ phase: 'day', from: 0, to: 24, minutes: 10 }],
    pauseOnPin: true, fixed: { midday: 12, golden: 17, sunset: 18, night: 22 }, presets: { dawn: 6, noon: 12, dusk: 18, night: 22 } };
  const skyRows = { file: 'weather/sky.json', clock, dome: { shape: 'dome', look: 'weather.dome', order: -100 }, flash: 1,
    lanes: { key: 'key', sample: 'sample', dome: 'dome', weather: 'weather', tint: 'tint' }, tint: [],
    from: { fog: 'fog', shade: 'shade', rim: 'rim', light: 'sunI' }, moon: { disc: [1, 1, 1], gain: 1, scale: 1, halo: 1, haloOpacity: 1 } };
  const program = { states: ['clear'], next: { clear: 'clear' }, length: { clear: [1, 1] }, soak: 1, dry: 1, salt: 1,
    initial: { overcast: 0, rain: 0, wet: 0, wind: 0, fog: 0 }, modes: { live: 'none' }, values: [], outputs: { overcast: 0, rain: 0, wet: 0, wind: 0, fog: 0 },
    page: { id: 'weather.clock', after: [], before: [], tick: 'weather.clock' } };
  const channels = parseClientChannels(['key', 'sample', 'dome', 'weather', 'tint'].map(group => {
    const dag = new ClientChannels(`weather.${group}`); dag.output('value', dag.constant(1));
    return Object.assign(dag.build(), { numeric: { group, outputs: [{ property: 'value', target: 'look', path: ['keyIntensity'] }] } });
  }));
  const source = emptyShardfile({ slug: 'clocked-weather', name: 'Weather', author: 'Fixture', revision: 1, seed: 1 }); source.clientChannels = channels;
  const rows = { ...policy, sky: skyRows }, values = new Map<string, unknown>([[row.file, rows], [skyRows.file, skyFile], [policy.files.program, program]]);
  let release: () => void = () => { throw new Error('No held weather file'); };
  let reached: () => void = () => { throw new Error('No held read notification'); };
  const reading = new Promise<void>(resolve => { reached = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; }), heldFile = hold === 'sky' ? skyRows.file : hold === 'program' ? policy.files.program : null;
  const product = createShardFolder({ slug: source.identity.slug, revision: 1, shardfile: source, sections: new Map(),
    files: new Map([...values.keys()].map(file => [file, fixtureFolderFile(file, { hash: file, url: file })])), jsonCheck: fixtureJsonCheck, read: async url => {
      trace.push(`read ${url}`); if (url === heldFile) { reached(); await gate; }
      return new TextEncoder().encode(JSON.stringify(values.get(url)));
    } });
  // Only the private clock/geometry projections are native test ports;
  // the forest document retains registered ingestion and all owner fences.
  const named = product.json.bind(product);
  vi.spyOn(product, 'json').mockImplementation(async name => {
    if (name !== skyRows.file && name !== policy.files.program) return named(name);
    const value: unknown = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(await product.file(name)));
    return value;
  });
  const scene = new Scene(), material = new MeshBasicMaterial(), disc = new Mesh(shape, material);
  const sky = legacyDouble<NonNullable<NonNullable<ShardContext['game']['runtime']>['world']>['sky']>({ sunDisc: disc });
  const game = legacyDouble<NonNullable<NonNullable<ShardContext['game']['runtime']>['world']>['game']>({ scene, levelScope: nativeOwner ?? scope });
  const world = legacyDouble<NonNullable<NonNullable<ShardContext['game']['runtime']>['world']>>({ game, sky,
    chunk: legacyDouble<NonNullable<NonNullable<ShardContext['game']['runtime']>['world']>['chunk']>({
      grade: legacyDouble<NonNullable<NonNullable<ShardContext['game']['runtime']>['world']>['chunk']['grade']>({ brightness: 1 }) }) });
  const runtime = legacyDouble<NonNullable<ShardContext['game']['runtime']>>({ world });
  const ctx = legacyDouble<ShardContext>({ scope, product, game: legacyDouble<ShardContext['game']>({ runtime }),
    app: legacyDouble<ShardContext['app']>({ params: new URLSearchParams() }),
    system: spec => { registrations.push(spec.id); }, debug: legacyDouble<ShardContext['debug']>({ expose: (id, value) => { exposed.set(id, value); } }) });
  lendLooks(scope, { materials: new Map([['weather.dome', material]]), setParam: () => undefined, setTexture: () => undefined, bindMeshMap: () => material });
  return { scope, ctx, runtime, world, scene, trace, registrations, exposed, release, reading, close(): void { scope.dispose(); shape.dispose(); material.dispose(); } };
}


test('real clocked weather runs through play rank40 with the same rig, clock and object loan', async () => {
  const f = clockedFixture();
  try {
    await CLIENT_FEATURES['weather.forest'].install(f.ctx, row, f.scope);
    const rig = entryOwner(f.scope, 'world-weather', row.owner), entered = f.scope.child('weather-entry');
    expect(rig.sky?.clock).toBeInstanceOf(DayCycle); expect(rig.weather.state).toBeTypeOf('string');
    expect(rig.sky?.clock.phase).toBe(.5); expect(entryOwner(f.scope, 'object', row.owner)).toBe(rig.group);
    expect(f.exposed.get(policy.debug)).toMatchObject({ clock: rig.sky?.clock, weather: rig.weather, group: rig.group });
    expect(f.registrations).toEqual([policy.system.id]);
    expect(f.trace).toEqual([`read ${row.file}`, 'read weather/sky.json', `read ${policy.files.program}`]);
    lendEntryOwner(entered, f.scope, 'world-weather', row.owner); expect(entryOwner(entered, 'world-weather', row.owner)).toBe(rig);
    entered.dispose(); expect(entryOwner(f.scope, 'world-weather', row.owner)).toBe(rig);
  } finally { f.close(); }
});

test('real inner sky and program reads fence ancestor retirement before geometry or registration', async () => {
  for (const held of ['sky', 'program'] as const) {
    const parent = new Scope('clocked-parent'), f = clockedFixture(held, parent), work = install(f.ctx);
    await f.reading; parent.onDispose(() => undefined); const retirement = parent.disposeSteps(); retirement.next();
    const children = f.scene.children.length;
    try {
      f.release(); await expect(work).rejects.toThrow('owner left or changed');
      expect(f.registrations).toEqual([]); expect(f.exposed.size).toBe(0); expect(f.scene.children).toHaveLength(children);
      expect(() => entryOwner(f.scope, 'world-weather', row.owner)).toThrow('ended');
    } finally { for (const step of retirement) void step; parent.dispose(); f.close(); }
  }
});

test('a concrete native world replaced during either inner read registers nothing', async () => {
  for (const held of ['sky', 'program'] as const) {
    const f = clockedFixture(held), { world } = f, work = install(f.ctx);
    await f.reading; const children = f.scene.children.length;
    try {
      f.runtime.world = { ...world }; f.release(); await expect(work).rejects.toThrow('owner left or changed');
      expect(f.registrations).toEqual([]); expect(f.exposed.size).toBe(0); expect(f.scene.children).toHaveLength(children);
      expect(() => entryOwner(f.scope, 'world-weather', row.owner)).toThrow('Missing live entry owner');
    } finally { f.runtime.world = world; f.close(); }
  }
});

test('an independently retired native level refuses publication while context scope stays live', async () => {
  for (const held of ['sky', 'program'] as const) for (const state of ['disposing', 'disposed']) {
    const native = new Scope('native-weather'), f = clockedFixture(held, undefined, native), work = install(f.ctx);
    await f.reading; native.onDispose(() => undefined); const retirement = native.disposeSteps(); retirement.next();
    if (state === 'disposed') for (const step of retirement) void step;
    const children = f.scene.children.length;
    try {
      expect(f.scope.disposed || f.scope.disposing).toBe(false); f.release(); await expect(work).rejects.toThrow('owner left or changed');
      expect(f.registrations).toEqual([]); expect(f.exposed.size).toBe(0); expect(f.scene.children).toHaveLength(children);
      expect(() => entryOwner(f.scope, 'world-weather', row.owner)).toThrow('Missing live entry owner');
    } finally { for (const step of retirement) void step; native.dispose(); f.close(); }
  }
});


test('a repeated weather or object publication refuses before another resource intake', async () => {
  for (const kind of ['world-weather', 'object'] as const) {
    const f = clockedFixture();
    try {
      if (kind === 'object') publishEntryOwner(f.scope, kind, row.owner, new Group());
      else publishEntryOwner(f.scope, kind, row.owner, legacyDouble<ForestWeatherRig>({}));
      await expect(install(f.ctx)).rejects.toThrow('already published');
      expect(f.trace).toEqual([]); expect(f.registrations).toEqual([]);
    } finally { f.close(); }
  }
});
