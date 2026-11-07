// @vitest-environment happy-dom
import { beforeEach, expect, test, vi } from 'vitest';
import * as v from 'valibot';
import { Group, PerspectiveCamera, Scene, Vector3 } from 'three';
import { Scope } from '@wildshard/engine/app/scope';
import { withOwner } from '@wildshard/engine/app/ownership';
import { EliteBar } from '@wildshard/engine/ui/EliteBar';
import { setTerrainHeight } from '@wildshard/engine/world/terrainHeight';
import { Elites, type EliteScript } from '../src/client/game/Elite';
import type { EncounterRow } from '../src/client/game/boss/barFeed';
import { wirePage } from '../src/client/game/shardfile/wirePage';
import type { EliteEnteredOwners } from '../src/client/game/eliteView';
import { EliteEnteredPresentationSchema } from '@wildshard/format/eliteFeature';
import { legacyDouble } from '@wildshard/engine/test/FakeGame';
import { mockCanvas } from '@wildshard/engine/test/weaponParity';

const def = { id: 'reed.guard', name: 'Reed Guardian', epithet: 'Nest watcher', lair: { x: 0, z: 0, r: 4 },
  awareR: 12, engageR: 8, leashR: 16, rule: 'always' as const, respawnMin: 1, signature: 'BEAK', phase2: 'NEST',
  drop: { skin: 'reed', skinName: 'REED', weapon: 'sword', blurb: 'woven reed grip' } };
const rows = v.parse(EliteEnteredPresentationSchema, { [def.id]: { prompt: 'Take the REED sword skin',
  toast: 'REED sword skin — woven reed grip', hum: true, sting: { banner: .8, phase2: 1, kill: 'chunk' } } });

beforeEach(() => { setTerrainHeight(() => 0); mockCanvas(); vi.spyOn(Math, 'random').mockReturnValue(.25); });

// N2: on the wire nothing steps a lair. Its row drives the stings and the trophy's feed line, and what a row held when it arrived is no moment.
test('on the wire a lair\'s row plays its banner, phase, trophy and kill stings', () => {
  const on = Object.getOwnPropertyDescriptor(wirePage, 'on'), encounters = vi.spyOn(wirePage, 'encounters');
  Object.defineProperty(wirePage, 'on', { get: () => true, configurable: true });
  const scope = new Scope('wire.elites'), scene = new Scene(), camera = new PerspectiveCamera(), events: unknown[][] = [];
  const hud = legacyDouble<EliteEnteredOwners['hud']>({ toast: text => { events.push(['toast', text]); } });
  const audio = legacyDouble<EliteEnteredOwners['audio']>({ pickupHum: () => undefined });
  const music = legacyDouble<EliteEnteredOwners['music']>({ sting: name => { events.push(['sting', name]); }, combat: intensity => { events.push(['combat', intensity]); } });
  const script: EliteScript = { def, animal: null, spawn: () => undefined, despawn: () => undefined, tick: () => undefined, enterPhase2: () => undefined, reset: () => undefined,
    trophy: () => { events.push(['trophy']); }, dropModel: () => new Group() };
  const row = (state: string, banners: number, phase: number): EncounterRow => ({ id: def.id, kind: 'elite', state, hp: 1, phase, shield: false, body: 0, skip: 0, banners, signatures: 0, known: true, sleep: 0, reward: null });
  try {
    withOwner(scope, () => {
      const elites = new Elites({ scene, camera, player: { position: new Vector3() }, condition: () => true }, new EliteBar(), 'reed-marsh', { read: () => ({}), write: () => undefined });
      elites.add(script); elites.bindEnteredPresentation({ scope, interactables: [], hud, audio, music }, rows);
      const frame = (state: string, banners: number, phase: number): void => { encounters.mockReturnValue([row(state, banners, phase)]); elites.update(.1, 0); };
      frame('dead', 2, 1); frame('idle', 2, 0); expect(events, 'what a row held when it arrived is no moment').toEqual([]);
      frame('aware', 3, 0); frame('engaged', 3, 0); frame('engaged', 3, 1); frame('engaged', 3, 1); frame('dead', 3, 1); frame('dead', 3, 1);
      expect(events).toEqual([['combat', .8], ['combat', 1], ['trophy'], ['sting', 'chunk']]);
    });
  } finally { scope.dispose(); encounters.mockRestore(); if (on === undefined) Reflect.deleteProperty(wirePage, 'on'); else Object.defineProperty(wirePage, 'on', on); }
});

test('entered binding refuses foreign, retired, duplicate or mismatched concrete owners', () => {
  const scope = new Scope('elite.owner'), foreign = new Scope('foreign'), retired = new Scope('retired'); retired.dispose();
  try {
    withOwner(scope, () => {
      const elites = new Elites({ scene: new Scene(), camera: new PerspectiveCamera(), player: { position: new Vector3() }, condition: () => false }, new EliteBar(), 'reed', { read: () => ({}), write: () => undefined });
      const owners = { scope, interactables: [], hud: legacyDouble<EliteEnteredOwners['hud']>({}), audio: legacyDouble<EliteEnteredOwners['audio']>({}), music: legacyDouble<EliteEnteredOwners['music']>({}) };
      expect(() => elites.bindEnteredPresentation({ ...owners, scope: foreign }, {})).toThrow('owner');
      expect(() => elites.bindEnteredPresentation({ ...owners, scope: retired }, {})).toThrow('owner');
      expect(() => elites.bindEnteredPresentation(owners, rows)).toThrow('identities');
      elites.bindEnteredPresentation(owners, {});
      expect(() => elites.bindEnteredPresentation(owners, {})).toThrow('owner');
      expect(() => elites.add(legacyDouble<EliteScript>({ def }))).toThrow('identities');
    });
  } finally { scope.dispose(); foreign.dispose(); }
});

test('presentation admission is finite JSON with no callback or effect registry', () => {
  const row = rows[def.id]; if (row === undefined) throw new Error('Missing presentation');
  for (const bad of [{ ...row, callback: () => undefined }, { ...row, sting: { ...row.sting, banner: Number.NaN } }, { ...row, sting: { ...row.sting, kill: 'arbitrary' } }, { ...row, prompt: () => 'Take' }]) {
    expect(() => v.parse(EliteEnteredPresentationSchema, { [def.id]: bad })).toThrow();
  }
});
