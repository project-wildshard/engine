import { expect, test } from 'vitest';
import { Vector3 } from 'three';
import { Events } from '../src/shared/engine/events/events';
import { Scope } from '../src/shared/engine/app/scope';
import { CombatPipeline } from '../src/shared/engine/combat/pipeline';
import { PlayerHealth } from '../src/shared/engine/combat/health';
import { AnimalSim } from '../src/shared/engine/entities/AnimalSim';
import { SIM_LEVEL } from './fixtures/sim-level/level';

function body(id: string) {
  const sample = SIM_LEVEL.entities[0]; if (sample === undefined) throw new Error('Missing creature spec');
  return new AnimalSim({ ...sample.spec, kind: 'same.label', hp: 100 }, 17, 1, id, { heightAt: () => 0, random: () => 0, now: () => 0 });
}
function fixture() {
  const events = new Events(), scope = new Scope('declared-combat'), combat = new CombatPipeline(events, scope);
  let dodge = false;
  const player = new PlayerHealth(events, { now: () => 0, position: () => new Vector3(), dodging: () => dodge, dodgeGuard: () => dodge });
  player.attributes.incomingCap = 10;
  combat.playerRules(scope, { target: player, capExempt: ['fixture.east'] });
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
    f.combat.rule({ id: 'east.multiplier', order: 60, when: { targetTags: ['creature.fixture.east'] }, op: 'mul', value: 2 }, f.scope);
    const hit = (target: AnimalSim) => f.combat.hit({ source: 'env', sourceTags: ['weapon.fixture'], target: target.combatActor(),
      amount: 20, point: new Vector3(), dir: new Vector3(), headshot: false });
    expect(hit(east)?.dealt).toBe(20); expect(hit(west)?.dealt).toBe(10);
    expect(east.kind).toBe('same.label'); expect(west.kind).toBe('same.label');
  } finally { f.scope.dispose(); }
});
test('explicit cap true and false override the older tag list while omission retains its policy', () => {
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
