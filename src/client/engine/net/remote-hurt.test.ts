// @vitest-environment happy-dom
// REMOTE-PLAYERS RP10 (Jake, 2026-11-12: "see the health bar going down as Jimmy is smacking it ... it's an MMO"): a shared fight
// reads whose blow is whose. Another player's hit on a creature shows its number smaller and paler than this page's own, with
// no HEADSHOT or KILL label; a hit on another player flashes that body red and pops a red number over it. Before RP10 others'
// hits on a creature drew no number, and a hit whose target was another player's handle was dropped by the page.
// oxlint-disable-next-line import/no-nodejs-modules -- The test reads the stylesheet the page loads.
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The stylesheet beside this file, under happy-dom.
import { join } from 'node:path';
import * as THREE from 'three';
import { afterEach, expect, test } from 'vitest';
import { Scope } from '../../../shared/engine/app/scope';
import { PLAYER_CLASS } from '../../../shared/engine/net/netSchemas';
import type { NetCombatEvent } from '../../../shared/engine/net/messages';
import type { NetClient } from './client';
import { OtherPlayers } from './otherPlayers';
import { hurtOther } from './hurtOther';
import { floatLook } from '../ui/Combat';

const DT = 1 / 60;
let scopes: Scope[] = [];
afterEach(() => { for (const scope of scopes) scope.dispose(); scopes = []; });

test('your own number is full size with its label; another player\'s is smaller and paler, with none', () => {
  expect(floatLook(true, false, false)).toEqual({ cls: '', label: '', kill: false });
  expect(floatLook(true, true, false).cls).toBe('head');
  expect(floatLook(true, false, true).kill).toBe(true);
  expect(floatLook(false, true, true)).toEqual({ cls: 'other', label: '', kill: false });
  // The sheet: `.other` is smaller than the plain float on desktop and on a phone, and its colour is see-through.
  const css = readFileSync(join(import.meta.dirname, '../ui/styles/combat.css'), 'utf8');
  const sizes = (rule: string): number[] => [...css.matchAll(new RegExp(String.raw`${rule.replaceAll('.', String.raw`\.`)} \{[^}]*font-size: (\d+)px`, 'gu'))].map(match => Number(match[1]));
  const own = sizes('.ws-combat-float b'), other = sizes('.ws-combat-float.other b');
  expect(own).toHaveLength(2); expect(other).toHaveLength(2);
  expect(other[0]).toBeLessThan(own[0] ?? 0); expect(other[1]).toBeLessThan(own[1] ?? 0);
  const colour = /\.ws-combat-float\.other b \{[^}]*color: rgba\([^)]*, (0\.\d+)\)/u.exec(css);
  expect(Number(colour?.[1] ?? 1)).toBeLessThan(0.8);
});

/** Jake's page (handle 1) drawing Jimmy at handle 2; a creature is at handle 40. */
function jakesPage(): { others: OtherPlayers; scene: THREE.Scene } {
  const scene = new THREE.Scene(), scope = new Scope('rp10-test'); scopes.push(scope);
  const entities = new Map([[2, { handle: 2, id: 'player-jimmy', cls: PLAYER_CLASS, initial: { name: 'Jimmy' } }]]);
  const client = { welcome: { handle: 1 }, entities, riders: new Map(), interpolator: { sample: (_handle: number, _tick: number, out: Float64Array) => { out.fill(0); return true; } } } as unknown as NetClient;
  const others = new OtherPlayers(client, scene, scope);
  others.frame(0, DT);
  return { others, scene };
}
const hit = (target: number, amount: number): NetCombatEvent => ({ kind: 'hit', tick: 1, target, amount, at: [0, 1, 0], head: false, killed: false, confirmFor: 0 });
const jimmy = (others: OtherPlayers) => { const shown = others.shown.find(other => other.name === 'Jimmy'); if (shown === undefined) throw new Error('no Jimmy'); return shown; };
/** The emissive of Jimmy's body mesh: red while it flashes. */
function glow(scene: THREE.Scene): number {
  const materials: unknown[] = [];
  scene.getObjectByName('Player · Jimmy')?.traverse(node => { if (node instanceof THREE.SkinnedMesh) materials.push((node as THREE.Mesh).material); });
  const material = materials[0];
  return material instanceof THREE.MeshStandardMaterial ? material.emissiveIntensity * material.emissive.r : 0;
}

test('a hit is routed to another player by its target handle, never for this page\'s own or a creature\'s', () => {
  const { others } = jakesPage();
  expect(hurtOther(hit(1, 9), 1, others)).toBe(false); // Jake's own: the page's own hurt does that
  expect(hurtOther(hit(40, 9), 1, others)).toBe(false); // a creature: RowBodies does that
  expect(hurtOther({ kind: 'died', tick: 1, id: 2, by: 1, dir: [0, 0, 1], impulse: 0 } as unknown as NetCombatEvent, 1, others)).toBe(false);
  expect(hurtOther(hit(2, 9), 1, null)).toBe(false); // a page that draws nobody
  expect(jimmy(others).hurt.hits).toBe(0);
  expect(hurtOther(hit(2, 12.4), 1, others)).toBe(true);
  expect(jimmy(others).hurt).toMatchObject({ hits: 1, last: 12 });
});

test('a hit on another player flashes the body red and pops a red number, both gone within a second', () => {
  const { others, scene } = jakesPage();
  expect(glow(scene)).toBe(0);
  hurtOther(hit(2, 12), 1, others);
  others.frame(0, DT);
  expect(jimmy(others).hurt.flash).toBeGreaterThan(0.8);
  expect(glow(scene)).toBeGreaterThan(0.5);
  expect(jimmy(others).hurt.numbers).toEqual(['12']);
  const number = scene.getObjectByName('Player · Jimmy')?.getObjectByName('HurtNumber');
  expect(number?.visible).toBe(true);
  // The body's own material, never the shared castaway's: no other body flashes with it.
  let shared = true;
  scene.getObjectByName('Player · Jimmy')?.traverse(node => { if (node instanceof THREE.SkinnedMesh) shared = (node.material as THREE.Material).userData['shared'] === true; });
  expect(shared).toBe(false);
  hurtOther(hit(2, 30), 1, others); others.frame(0, DT);
  expect(jimmy(others).hurt.numbers).toEqual(['12', '30']);
  for (let t = 0; t < 1.2; t += DT) others.frame(0, DT);
  expect(jimmy(others).hurt.flash).toBe(0);
  expect(glow(scene)).toBe(0);
  expect(jimmy(others).hurt.numbers).toEqual([]);
  expect(jimmy(others).hurt.hits).toBe(2);
});

test('Combat draws another player\'s blow on a creature in the pale style, and this page\'s own in full', async () => {
  const { Combat } = await import('../ui/Combat');
  const camera = new THREE.PerspectiveCamera(70, 402 / 874, 0.1, 500); camera.position.set(0, 1, 5); camera.lookAt(0, 1, 0); camera.updateMatrixWorld(true);
  const animals = { animals: [], nearRay: () => null } as unknown as ConstructorParameters<typeof Combat>[1];
  const game = { onUpdate: () => undefined } as unknown as ConstructorParameters<typeof Combat>[0];
  const combat = new Combat(game, animals, {}, camera);
  scopes.push(combat.scope);
  const creature = { headWorld: (out: THREE.Vector3) => out.set(0, 1.2, 0) };
  animals.onOthersHit?.(creature as never, 17.2, new THREE.Vector3(0, 1, 0), false);
  animals.onDamage?.(creature as never, 40, new THREE.Vector3(0.3, 1, 0), false, false);
  const shown = [...document.querySelectorAll('.ws-combat-float.show')].map(el => ({ text: el.querySelector('b')?.textContent, other: el.classList.contains('other') }));
  expect(shown).toEqual([{ text: '17', other: true }, { text: '40', other: false }]);
});
