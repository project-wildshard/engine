import { compileIncomingCapPolicy } from '@wildshard/format/incomingCapPolicy';
import { expect, test } from 'vitest';
import { Vector3 } from 'three';
import { Events } from '../src/shared/engine/events/events';
import { Scope } from '../src/shared/engine/app/scope';
import { CombatPipeline, type Actor, type CombatTag } from '../src/shared/engine/combat/pipeline';
import { PlayerHealth } from '../src/shared/engine/combat/health';
import { AnimalSim } from '../src/shared/engine/entities/AnimalSim';
import { SIM_LEVEL } from './fixtures/sim-level/level';

function body(id: string, kind = 'same.label') {
  const sample = SIM_LEVEL.entities[0]; if (sample === undefined) throw new Error('Missing creature spec');
  return new AnimalSim({ ...sample.spec, kind, hp: 100 }, 17, 1, id, { heightAt: () => 0, random: () => 0, now: () => 0 });
}
function fixture(capExemptTags: readonly string[] = ['fixture.east', 'creature.fixture.east']) {
  const events = new Events(), scope = new Scope('declared-combat'), combat = new CombatPipeline(events, scope);
  let dodge = false;
  const player = new PlayerHealth(events, { now: () => 0, position: () => new Vector3(), dodging: () => dodge, dodgeGuard: () => dodge });
  player.attributes.incomingCap = 10;
  combat.playerRules(scope, { target: player, capExemptTags });
  const hit = (source: AnimalSim, amount = 30) => combat.hit({ source: source.combatActor(), sourceTags: source.combatActor().tags,
    target: player, amount, point: new Vector3(), dir: new Vector3(), headshot: false });
  return { events, scope, combat, player, hit, dodge: () => { dodge = true; } };
}
test('real creature targets with one label retain distinct row tags even after the actor port was cached', () => {
  const f = fixture(), east = body('east'), west = body('west'), original = east.combatActor(), tags = original.tags;
  try {
    east.species = 'fixture.east'; west.species = 'fixture.west'; east.mods.damageTaken = .5; west.mods.damageTaken = .5;
    expect(east.combatActor()).toBe(original); expect(original.tags).toBe(tags);
    expect(original.tags).toContain('creature.fixture.east'); expect(west.combatActor().tags).toContain('creature.fixture.west');
    expect(original.tags).toContain('creature.same.label'); expect(west.combatActor().tags).toContain('creature.same.label');
    f.combat.rule({ id: 'east.multiplier', order: 60, when: { targetTags: ['creature.fixture.east'] }, op: 'mul', value: 2 }, f.scope);
    const hit = (target: AnimalSim) => f.combat.hit({ source: 'env', sourceTags: ['weapon.fixture'], target: target.combatActor(),
      amount: 20, point: new Vector3(), dir: new Vector3(), headshot: false });
    expect(hit(east)?.dealt).toBe(20); expect(hit(west)?.dealt).toBe(10);
    expect(east.kind).toBe('same.label'); expect(west.kind).toBe('same.label');
  } finally { f.scope.dispose(); }
});
test('explicit cap true and false override the compiled exact tags while omission retains its policy', () => {
  for (const [flag, expected] of [[true, 30], [false, 10], [undefined, 30]] as const) {
    const f = fixture(), source = body('east'); source.species = 'fixture.east'; source.capExempt = flag;
    try { expect(f.hit(source)?.dealt).toBe(expected); expect(f.player.attributes.health).toBe(100 - expected); }
    finally { f.scope.dispose(); }
  }
  const f = fixture(), source = body('west'); source.species = 'fixture.west';
  try { expect(f.hit(source)?.dealt).toBe(10); } finally { f.scope.dispose(); }
});
test('an exempt declared source still crosses the original dodge guard before the cap phase', () => {
  const f = fixture(), source = body('east'); source.species = 'fixture.east'; source.capExempt = true;
  try { f.dodge(); expect(f.hit(source)).toBeNull(); expect(f.player.attributes.health).toBe(100); }
  finally { f.scope.dispose(); }
});

test('compiled tags retain dynamic attack, state and effect exemptions on real actors', () => {
  for (const origin of ['request', 'state', 'effect'] as const) {
    const f = fixture(['state.rage']), original = body('dynamic').combatActor();
    const source: Actor = { ...original, state: origin === 'state' ? ['state.rage'] : [],
      effectTags: origin === 'effect' ? ['state.rage'] : [] };
    const sourceTags: readonly CombatTag[] = origin === 'request' ? ['creature.dynamic', 'state.rage'] : ['creature.dynamic'];
    try {
      expect(f.combat.hit({ source, sourceTags, target: f.player, amount: 30, point: new Vector3(), dir: new Vector3() })?.dealt).toBe(30);
    } finally { f.scope.dispose(); }
  }
});
test('compiled tags retain environment ownership and match punctuation literally', () => {
  for (const [tag, expected] of [['effect.hot', 30], ['effect.cold', 10], ['state.raging', 10], ['state.*', 30]] as const) {
    const f = fixture(['effect.hot', 'state.*']);
    try {
      const result = f.combat.hit({ source: 'env', sourceTags: ['creature.dynamic', tag], target: f.player,
        amount: 30, point: new Vector3(), dir: new Vector3(), cause: { kind: 'charge', label: 'Original charge' } });
      expect(result?.dealt).toBe(expected); expect(result?.req.source).toBe('env');
      expect(result?.req.cause).toEqual({ kind: 'charge', label: 'Original charge' });
    } finally { f.scope.dispose(); }
  }
});
test('malformed exact tags refuse before installing a player rule', () => {
  for (const tags of [['undotted'], ['state.rage', 'state.rage']]) {
    expect(() => fixture(tags)).toThrow();
  }
});

test('the native captain retains the level exemption even when hunt metadata omits it', () => {
  const tags = compileIncomingCapPolicy({ capExempt: ['captain'] });
  for (const [flag, expected] of [[undefined, 24], [false, 20], [true, 24]] as const) {
    const f = fixture(tags), source = body('native.captain', 'captain');
    f.player.attributes.incomingCap = 20; source.capExempt = flag;
    try {
      expect(source.species).toBe('');
      const result = f.combat.hit({ source: source.combatActor(), sourceTags: source.combatActor().tags,
        target: f.player, amount: 24, point: new Vector3(), dir: new Vector3() });
      expect(result?.dealt).toBe(expected);
    } finally { f.scope.dispose(); }
  }
});
