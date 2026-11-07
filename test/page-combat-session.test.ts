// @vitest-environment happy-dom
import { beforeEach, expect, test, vi } from 'vitest';
import { Vector3 } from 'three';
import { App } from '@wildshard/engine/app/app';
import { Scope } from '@wildshard/engine/app/scope';
import { PlayerHealth } from '@wildshard/engine/combat/health';
import { EffectService } from '@wildshard/engine/combat/effects/EffectService';
import type { DamageDealt } from '@wildshard/engine/combat/pipeline';
import { bindFlatTerrain } from '@wildshard/engine/test/terrain';
import { PageCombatSession } from '../src/client/game/Boss';
import type { ShardContext } from '../src/client/game/plugin/context';
import { manager } from '@wildshard/engine/test/manager';
import { registerSpecies } from '@wildshard/engine/entities/species/registry';
import { speciesWithLook } from '@wildshard/engine/entities/species/look';
import { BOAR } from '../src/client/game/systems/species/boar';
import { BOAR_LOOK } from '../src/client/game/systems/species/view/boar';

beforeEach(() => { registerSpecies(speciesWithLook(BOAR, BOAR_LOOK)); });

const rows = { god: false, bossKinds: ['boar'], stunEffect: 'effect.marsh-root', unlockSkins: [] };
function marsh() {
  const restoreTerrain = bindFlatTerrain({ heightAt: () => 0, normalAt: () => [0, 1, 0], waterLevel: () => -100 });
  const scope = new Scope('salt-marsh.combat'), app = new App(), fixture = manager();
  Object.defineProperty(fixture.sky, 'dayNight', { value: null });
  app.levelScope = scope;
  const health = new PlayerHealth(app.events, { now: () => app.clock.now, dodging: () => false, dodgeGuard: () => false, position: () => fixture.player.position });
  app.registerPlayer(health, scope);
  const effects = new EffectService([{ id: 'effect.marsh-root', kind: 'timed', duration: 2, stacking: 'refresh', tags: ['status.root'],
    modifiers: [{ attr: 'moveLocked', op: 'override', value: 1 }] }], scope);
  app.registerEffects(effects, scope);
  const setEnabled = vi.fn<(on: boolean) => void>(), toast = vi.fn<(text: string) => void>(), feed = vi.fn<(text: string) => void>();
  const add = vi.fn<(id: string, count?: number) => void>();
  const context = { app, scope } as ShardContext;
  Object.defineProperty(context, 'game', { value: { runtime: {
    world: { game: fixture.game, sky: fixture.sky, player: fixture.player },
    play: { animals: fixture.manager, weapons: { setEnabled }, hud: { toast, killFeed: feed }, inventory: { add } },
  } } });
  const dispose = (): void => { scope.dispose(); fixture.manager.animals.slice().forEach(actor => { fixture.manager.retire(actor); }); restoreTerrain(); };
  return { ...fixture, app, scope, health, effects, context, setEnabled, toast, feed, add, dispose };
}

test('an unrelated marsh encounter uses native damage and declared source tags', () => {
  const f = marsh();
  try {
    const session = new PageCombatSession(f.context, rows), events: DamageDealt[] = [];
    f.app.events.on('damage.dealt', event => { events.push(event); }, f.scope);
    const boss = f.manager.spawn('boar', 3, 2, 0), creature = f.manager.spawn('boar', 2, 3, 0);
    expect(session.context.reach(boss, f.player.position)).toBe(true);
    session.context.hurt(boss, 11);
    new PageCombatSession(f.context, { ...rows, bossKinds: [] }).context.hurt(creature, 7, true);
    f.app.events.flush('update');
    expect(f.health.attributes.health).toBe(82);
    expect(events.map(event => event.req.sourceTags.slice(0, 3))).toEqual([
      ['boss.boar', 'feel.blow', 'cover.checked'], ['creature.boar', 'feel.blow', 'cover.checked'],
    ]);
    expect(events[1]?.req.throughWalls).toBe(true);
    expect(events[0]?.req.source).toBe(boss.combatActor());
    expect(f.health.cause).toEqual({ kind: 'boar', label: creature.label });
  } finally { f.dispose(); }
});

test('intro and timed status locks release independently and death clears the status', () => {
  const f = marsh();
  try {
    const session = new PageCombatSession(f.context, rows);
    session.context.stun(3); expect(f.player.carried).toBe(true);
    session.lockInput(true); session.lockInput(false); expect(f.player.carried).toBe(true);
    f.effects.update(3); session.legs(); expect(f.player.carried).toBe(false);
    session.lockInput(true); session.context.stun(1); f.effects.update(1); session.legs(); expect(f.player.carried).toBe(true);
    session.onPlayerDeath(); expect(f.player.carried).toBe(false);
    expect(f.effects.active(f.health)).toEqual([]);
    expect(f.setEnabled.mock.calls).toEqual([[false], [true], [false]]);
  } finally { f.dispose(); }
});

test('god mode and scope disposal prevent stale combat effects', () => {
  const f = marsh();
  try {
    const actor = f.manager.spawn('boar', 3, 2, 0), god = new PageCombatSession(f.context, { ...rows, god: true });
    god.context.hurt(actor, 90); god.context.stun(4);
    expect(f.health.attributes.health).toBe(100); expect(f.effects.active(f.health)).toEqual([]);
    const session = new PageCombatSession(f.context, rows);
    session.context.toast('Reeds stir'); session.context.feed('Sentry down'); session.context.addItem('amber-resin', 2);
    expect(f.toast).toHaveBeenCalledWith('Reeds stir'); expect(f.feed).toHaveBeenCalledWith('Sentry down'); expect(f.add).toHaveBeenCalledWith('amber-resin', 2);
    expect(session.context.night()).toBe(0); expect(session.context.dusk()).toBe(0);
    session.context.shot('unloaded', new Vector3());
    f.scope.dispose(); session.context.hurt(actor, 90); session.context.toast('Stale'); session.context.feed('Stale'); session.context.addItem('amber-resin');
    expect(f.health.attributes.health).toBe(100); expect(f.toast).toHaveBeenCalledTimes(1); expect(f.feed).toHaveBeenCalledTimes(1); expect(f.add).toHaveBeenCalledTimes(1);
    expect(() => new PageCombatSession(f.context, rows)).toThrow('entered player');
  } finally { f.dispose(); }
});

test('combat rows reject callbacks and invalid effect ids before installing', () => {
  const f = marsh();
  try {
    expect(() => new PageCombatSession(f.context, { ...rows, hurt: () => undefined })).toThrow();
    expect(() => new PageCombatSession(f.context, { ...rows, stunEffect: 'not-an-effect' })).toThrow();
    expect(() => new PageCombatSession(f.context, { ...rows, bossKinds: Array.from({ length: 65 }, () => 'boar') })).toThrow();
    expect(f.setEnabled).not.toHaveBeenCalled();
  } finally { f.dispose(); }
});
