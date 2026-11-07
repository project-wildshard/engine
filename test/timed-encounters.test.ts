
import { ReturnProgram } from '../src/shared/game/population/returnProgram';
import { parse } from 'valibot';
import { TimedEncountersSchema } from '@wildshard/format/encounterRows';
import { CueDirector } from '../src/client/game/audio/cueDirector';
import { expect, test } from 'vitest';
import { BoxGeometry, MeshBasicMaterial, PerspectiveCamera, Scene, Vector3, type Vector2 } from 'three';
import { app } from '../src/client/engine/app/runtime';
import { Scope } from '../src/shared/engine/app/scope';
import type { Game } from '../src/client/engine/core/Game';
import type { Player } from '../src/client/engine/player/Player';
import type { DayCycleClock } from '../src/shared/engine/world/dayCycle';
import { TimedEncounters } from '../src/client/game/boss/timedEncounters';
import { setTerrainHeight, setTerrainPlacement } from '../src/shared/engine/world/terrainHeight';
import { legacyDouble } from '@wildshard/engine/test/FakeGame';
import { lendLooks } from '../src/client/game/shardfile/lentLooks';
import { NALATI_NIGHT as nightInput } from './fixtures/nalati-night';
import {withWeatherWitness} from './fixtures/weatherInlineWitness';
import strikes from './fixtures/nalati-strikeProfiles-original.json' with { type: 'json' };

// Match the emitted combat wire; CueDirector borrows the separate presentation cues.
const {cues, ...night}=withWeatherWitness(nightInput);

/** The night's two spray looks (data/lookGraphs.json), lent as the runtime lends every look before the world builds. */
function lendSprays(scope: Scope): void {
  // the sprays, and the tell's and ghosts' looks that each pooled wedge and rider material takes a copy of
  const looks = ['nalati-spray-debris', 'nalati-spray-mist', 'nalati-tell', 'nalati-ghost', 'nalati-ghost-captain', 'nalati-ghost-storm'];
  lendLooks(scope, { materials: new Map(looks.map(id => [id, new MeshBasicMaterial()])), setParam: () => undefined,
    setTexture: () => undefined, bindMeshMap: () => { throw new Error('No mapped looks in the night'); },
    instance: () => ({ material: new MeshBasicMaterial(), setParam: () => undefined }) });
}

test('the listed night binding preserves phases, native identities, figures and contact rows', () => {
  setTerrainHeight(() => 0); setTerrainPlacement(() => [0, 1, 0], () => -1000);
  const scope = new Scope('marsh.watch'), figure = new BoxGeometry(.2, .5, .3);
  lendSprays(scope);
  const game = legacyDouble<Game>({ app, levelScope: scope, scene: new Scene(), camera: new PerspectiveCamera(),
    renderer: legacyDouble<Game['renderer']>({ getDrawingBufferSize: (out: Vector2) => out.set(400, 800) }) });
  const rows = { ...night, presentation: 'marsh', phases: { slots: ['golden'], patrol: [] }, lightFloor: .7,
    slots: { ...night.slots, actors: { ...night.slots.actors, kind: 'marsh-guard' } },
    patrol: { ...night.patrol, actors: { ...night.patrol.actors, kind: 'marsh-watch' } },
    contact: { strike: strikes.arrow, tags: ['creature.marsh-watch'], origin: 'actor' } };
  try {
    const clock = legacyDouble<DayCycleClock>({ dayPhase: 'day' });
    let clockReads=0;
    const watch = new TimedEncounters({ game, player: legacyDouble<Player>({ position: new Vector3(1, 0, 2) }), sky: legacyDouble({}), forest: legacyDouble({}), sites: null, get clock(){clockReads++;return clock;} },
      parse(TimedEncountersSchema,rows), { rider: figure, captain: figure, storm: figure }, ReturnProgram.page(night.program), new CueDirector(game, cues, scope));
    expect(watch.slots).toBeDefined(); expect(watch.riders).toBeDefined();
    expect(watch.target(new Vector3(), new Vector3(0, 0, 1), 10, null)).toBeNull();
    watch.update(.05, .05);expect(clockReads).toBe(0);
    expect(() => parse(TimedEncountersSchema,{ ...rows, contact: { ...rows.contact, tags: ['bad'] } })).toThrow();
  } finally { scope.dispose(); figure.dispose(); }
});
