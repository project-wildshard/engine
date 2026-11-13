// @vitest-environment happy-dom
// oxlint-disable-next-line import/no-nodejs-modules -- Rapier is shipped bytes.
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, expect, test } from 'vitest';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { Scope } from '../src/shared/engine/app/scope';
import { createSimHost } from '../src/server/engine/sim';
import { installRoomRespawn } from '../src/server/game/roomRespawn';
import { actRoutes } from '../src/shared/engine/sim/actRoutes';
import { UNSTUCK_ACT } from '../src/shared/engine/net/acts';
import { netInteractCommands } from '../src/shared/host/standalone/netInput';
import { setDev } from '../src/client/engine/core/devMode';
import { buildDebugMenu } from '../src/client/engine/ui/DebugMenu';
import { DEBUG_ROWS } from '../src/client/engine/ui/debugOptions';
import { installUnstuck } from '../src/client/engine/ui/unstuck';
import { SIM_LEVEL } from './fixtures/sim-level/level';

// Jake, 2026-11-12 (after "glitched into the pond cant use shift to surface"): "Need a button in <dev> to unstuck in settings,
// unstuck will respawn me like the death behavior but gets me unstuck". The DEV tab's Unstuck row, the page that answers it, and
// the server that places the player on a world.

let rapier: Rapier;
beforeAll(async () => { rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')); });
const owners: Scope[] = [];
afterEach(() => { for (const scope of owners.splice(0)) scope.dispose(); setDev(false); document.body.replaceChildren(); });

/** Tap the DEV tab's Unstuck button, as a finger does, and let its run settle. */
async function tapUnstuck(): Promise<void> {
  const scope = new Scope('unstuck.menu'); owners.push(scope);
  const card = document.createElement('div'); document.body.append(card);
  const row = buildDebugMenu(card, { scope, purpose: 'developer' }).row('unstuck');
  const button = row?.querySelector<HTMLButtonElement>('.ws-dbg-action');
  if (button === undefined || button === null) throw new Error('No Unstuck button in the DEV tab');
  expect(button.textContent).toBe('Unstuck');
  button.dispatchEvent(new PointerEvent('pointerup', { button: 0, bubbles: true }));
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

test('the DEV tab has an Unstuck button among its developer tools', () => {
  const row = DEBUG_ROWS.find(r => r.id === 'unstuck');
  expect(row).toMatchObject({ purpose: 'developer', group: 'tools', reload: false, action: { text: 'Unstuck' } });
});

test('pressing Unstuck on a local page closes the menu and puts the player where a death would, with no death', async () => {
  setDev(true);
  const scope = new Scope('unstuck.page'); owners.push(scope);
  const calls: string[] = [], feet = { x: 25, y: -1.9, z: 20 }, spawn = { x: 0, y: 1, z: -9 };
  installUnstuck(scope, { busy: () => false, online: () => false, send: () => { calls.push('send'); }, close: () => { calls.push('close'); },
    place: () => { Object.assign(feet, spawn); calls.push('place'); }, respawned: () => { calls.push('respawned'); } });
  await tapUnstuck();
  expect(calls).toEqual(['close', 'place', 'respawned']);
  expect(feet).toEqual(spawn);
});

test('on a world the page asks the server, and nothing runs under a death\'s fade or with Developer off', async () => {
  const scope = new Scope('unstuck.world'); owners.push(scope);
  const calls: string[] = [];
  let busy = false;
  installUnstuck(scope, { busy: () => busy, online: () => true, send: () => { calls.push('send'); }, close: () => { calls.push('close'); },
    place: () => { calls.push('place'); }, respawned: () => { calls.push('respawned'); } });
  await tapUnstuck(); // Developer off: the row does nothing
  expect(calls).toEqual([]);
  setDev(true);
  await tapUnstuck();
  expect(calls).toEqual(['close', 'send']);
  busy = true; calls.length = 0;
  await tapUnstuck();
  expect(calls).toEqual([]);
});

test('the server answers an Unstuck: the player goes to the spawn a fall would give, with no fall counted', () => {
  const host = createSimHost(SIM_LEVEL, { rapier }); installRoomRespawn(host, []); host.respawn.served = true;
  const lead = [...host.players.values()][0];
  if (lead === undefined) throw new Error('No lead');
  host.step();
  lead.resetPose({ x: 12, y: lead.position.y - 3, z: 12 }, 0); // stuck somewhere under the ground
  const health = lead.health.attributes.health, respawned: string[] = [];
  host.events.on('player.respawned', ({ player }) => { if (player !== undefined) respawned.push(player); }, host.scope);
  const commands = netInteractCommands(actRoutes(host), [{ kind: 'interact', seq: 1, id: UNSTUCK_ACT }], lead.id);
  expect(commands).toEqual([]);
  const { at } = host.level.player;
  expect(lead.position.distanceTo(at)).toBeLessThan(1e-6);
  host.step(); // the host's events reach their listeners on its step, as a death's respawn does
  expect(respawned).toEqual([lead.id]);
  expect(host.respawn.falls(lead.id)).toBe(0);
  expect(lead.health.attributes.health).toBe(health);
  expect(actRoutes(host).refused).toBe(0);
  host.dispose();
});
