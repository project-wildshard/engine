import {fixtureFolderFile,fixtureJsonCheck} from './fixtures/folderFile';
import { liveBalbalProjection, liveNight as NALATI_NIGHT, liveStrikeProfiles } from './fixtures/liveNalati';
import { ReturnModulesSchema } from '@wildshard/format/scriptContract';
import { ReturnProgram } from '../src/shared/game/population/returnProgram';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { builtFolder } from '../src/test/game/builtFolder';
import { expect, test } from 'vitest';
import * as v from 'valibot';
import { BoxGeometry, MeshBasicMaterial, PerspectiveCamera, Scene, Vector3, type Vector2 } from 'three';
import { Scope } from '../src/shared/engine/app/scope';
import { app } from '../src/client/engine/app/runtime';
import type { Game } from '../src/client/engine/core/Game';
import type { Player } from '../src/client/engine/player/Player';
import type { DayCycleClock } from '../src/shared/engine/world/dayCycle';
import { TimedEncountersSchema } from '@wildshard/format/encounterRows';
import { parseDecisionScripts } from '@wildshard/format/decisionScripts';
import { parseClientPlan } from '@wildshard/format/clientPlan';
import type { ShardContext } from '../src/client/game/plugin/context';
import type { ShardWorld } from '../src/server/game/shard/world';
import type { ShardRuntime } from '../src/shared/game/shard/runtime';
import type { FixedDraws } from '../src/client/game/models/fixedDraws';
import type { ForestWeatherRig } from '../src/client/game/weather/forest';
import { CueDirector } from '../src/client/game/audio/cueDirector';
import { createShardFolder } from '../src/shared/game/shardfile/shardFolder';
import { clientNativeBook } from '../src/client/game/shardfile/clientNativeBook';
import { entryOwner, publishEntryOwner } from '../src/shared/game/shardfile/entryOwners';
import { installClientTimedEncounters } from '../src/client/game/shardfile/clientTimedEncounters';
import { lendLooks } from '../src/client/game/shardfile/lentLooks';
import { sha256 } from '../src/shared/game/plugin/moduleHash';
import { emptyShardfile } from '../src/shared/host/author';
import { legacyDouble } from '@wildshard/engine/test/FakeGame';
import { withWeatherWitness } from './fixtures/weatherInlineWitness';

const input = {kind: 'timed.encounters', owner: 'quarry.watch', file: 'combat/timed-encounters.json', draws: 'quarry.draws', species: 'quarry.species', guest: 'guardian', weather: 'quarry.weather',
  figures: {rider: 'quarry.guard', captain: 'quarry.captain', storm: 'rider'}};
/** The balbal's return modules, lent as Nalati's kit lends them before its night installs (clientReturnModules.ts). */
async function lendGuestModules(scope: Scope): Promise<void> {
  const nalati = await loadHeadlessFolder(builtFolder('nalati-grasslands'));
  const rows = v.parse(ReturnModulesSchema, nalati.section('actors/return-scripts')), assets = new Map<string, Uint8Array>();
  await ReturnProgram.prepareModules(nalati, assets, rows);
  await ReturnProgram.admitModules(assets, rows, () => Promise.resolve());
  ReturnProgram.lendModules(scope, assets, rows);
}
function fixture(retireOnRead = false) {
  const scope = new Scope('quarry.encounters'), copies: string[] = [], figure = new BoxGeometry(.2, .5, .3);
  const looks = ['nalati-spray-debris', 'nalati-spray-mist', 'nalati-tell', 'nalati-ghost', 'nalati-ghost-captain', 'nalati-ghost-storm'];
  lendLooks(scope, {materials: new Map(looks.map(id => [id, new MeshBasicMaterial()])), setParam: () => undefined, setTexture: () => undefined,
    bindMeshMap: () => { throw new Error('No mapped watch looks'); }, instance: () => ({material: new MeshBasicMaterial(), setParam: () => undefined})});
  // Match the emitted combat wire; CueDirector borrows the separate presentation cues.
  const {cues, ...raw} = v.parse(v.record(v.string(), v.unknown()), structuredClone(NALATI_NIGHT));
  const strikes = liveStrikeProfiles;
  const admitted = v.parse(TimedEncountersSchema, {...raw,
    presentation: 'quarry', contact: {strike: strikes['arrow'], tags: ['creature.quarry'], origin: 'actor'}});
  const script = parseDecisionScripts([admitted.program.script])[0];
  if (script === undefined) throw new Error('Missing original watch programme');
  const night = withWeatherWitness({...admitted, program: {...admitted.program, script}});
  const bytes = new TextEncoder().encode(JSON.stringify(night)), hash = sha256(bytes);
  // FORMAT-PRUNE FP20: the guest's programme is its declared species row's projection (Nalati's balbal; no catalogue owner)
  const empty = emptyShardfile({slug: 'quarry', name: 'Quarry', author: 'Fixture', revision: 1, seed: 1});
  const shardfile = {...empty, rows: {...empty.rows, species: [Object.assign(legacyDouble<(typeof empty.rows.species)[number]>({id: 'quarry.guardian', kind: input.guest}), {projection: liveBalbalProjection})]}};
  const product = createShardFolder({slug: 'quarry', revision: 1, shardfile, sections: new Map(),
    files: new Map([[input.file, fixtureFolderFile(input.file,{hash, url: '/watch.json'})]]), jsonCheck:fixtureJsonCheck, read: () => { if (retireOnRead) scope.dispose(); return Promise.resolve(bytes); }});
  const game = legacyDouble<Game>({app, levelScope: scope, scene: new Scene(), camera: new PerspectiveCamera(), renderer: legacyDouble<Game['renderer']>({getDrawingBufferSize: (out: Vector2) => out.set(400, 800)})});
  const world = legacyDouble<ShardWorld>({game, sky: legacyDouble<ShardWorld['sky']>({}), forest: legacyDouble<ShardWorld['forest']>({}), player: legacyDouble<Player>({position: new Vector3()})});
  const ctx = legacyDouble<ShardContext>({scope, product, game: legacyDouble<ShardContext['game']>({runtime: legacyDouble<ShardRuntime>({world})})});
  const draws: FixedDraws = {ready: true, load: () => Promise.resolve(), handle: id => legacyDouble<ReturnType<FixedDraws['handle']>>({copy() { copies.push(id); return figure.clone(); }})};
  publishEntryOwner(scope, 'fixed-draws', input.draws, draws);
  clientNativeBook(ctx).presentations.set('quarry', new CueDirector(game, cues, scope));
  const clock = legacyDouble<DayCycleClock>({dayPhase: 'day'});
  const sky = legacyDouble<NonNullable<ForestWeatherRig['sky']>>({clock});
  const rig = legacyDouble<ForestWeatherRig>({sky, storm: legacyDouble<NonNullable<ForestWeatherRig['storm']>>({})});
  return {scope, copies, figure, product, game, ctx, clock, rig};
}
test('finite construction rows refuse callbacks, paths and an unknown storm alias', () => {
  expect(parseClientPlan({version: 1, features: [input]}).features).toEqual([input]);
  for (const row of [{...input, clock: () => 0}, {...input, read: 'world.weather.clock'}, {...input, figures: {...input.figures, storm: 'separate'}}])
    expect(() => parseClientPlan({version: 1, features: [row]})).toThrow();
});
test('the original two figure copies publish one watch and defer the day-clock loan until update', async () => {
  const f = fixture();
  try {
    await lendGuestModules(f.scope);
    const night = await installClientTimedEncounters(f.ctx, input);
    expect(entryOwner(f.scope, 'timed-encounters', input.owner)).toBe(night);
    expect(f.copies).toEqual([input.figures.rider, input.figures.captain]);
    await expect(installClientTimedEncounters(f.ctx, input)).rejects.toThrow('already exists');
    expect(f.copies).toHaveLength(2);
    expect(() => night.update(.01, .01)).not.toThrow();
  } finally { f.scope.dispose(); f.figure.dispose(); }
});
test('retirement during named-file admission refuses before encounter presentation and publication', async () => {
  const f = fixture(true), before = f.game.scene.children.length;
  try {
    await lendGuestModules(f.scope);
    await expect(installClientTimedEncounters(f.ctx, input)).rejects.toThrow('owner left during admission');
    expect(f.game.scene.children.length).toBeLessThanOrEqual(before);
    expect(() => entryOwner(f.scope, 'timed-encounters', input.owner)).toThrow('scope has ended');
  } finally { f.scope.dispose(); f.figure.dispose(); }
});
