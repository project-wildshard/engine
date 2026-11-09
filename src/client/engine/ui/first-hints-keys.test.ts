// @vitest-environment happy-dom
import { afterEach, expect, test } from 'vitest';
import { Scope } from '../../../shared/engine/app/scope';
import { app } from '../app/runtime';
import { setKeyPlatform } from '../input/platform';
import { deskHint } from './FirstHints';

const owners: Scope[] = [];
afterEach(() => { for (const owner of owners.splice(0)) owner.dispose(); setKeyPlatform(undefined); });

test('KP1 (Jake 2026-11-09, "It says press Alt to dodge ... I pressed Command"): the desktop hint names the player\'s keys in their platform\'s words', () => {
  const scope = new Scope('hint-keys'); owners.push(scope);
  app.input.register({ id: 'hints.onFoot', actions: ['dodge', 'lock', 'use', 'jump'],
    keys: { dodge: ['KeyV', 'AltLeft'], lock: ['Mouse1', 'KeyZ'], use: ['KeyE'], jump: ['Space'] } }, scope);
  setKeyPlatform('mac');
  expect(deskHint('dodge')).toBe('V / ⌥ Option to dodge');
  expect(deskHint('jump')).toBe('Space to jump');
  expect(deskHint('use')).toBe('E to use');
  expect(deskHint('lock')).toBe('MMB / Z to lock');
  setKeyPlatform('windows');
  expect(deskHint('dodge')).toBe('V / Alt to dodge');
  // a rebound key shows as the player set it
  app.input.bindings.assign('hints.onFoot', 'dodge', ['KeyB']);
  expect(deskHint('dodge')).toBe('B to dodge');
  app.input.bindings.reset();
});
