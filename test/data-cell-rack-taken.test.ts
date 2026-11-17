// @vitest-environment node
import { expect, test } from 'vitest';
import { Group, PerspectiveCamera, Vector3 } from 'three';
import { Scope } from '../src/shared/engine/app/scope';
import { EquipmentService } from '../src/client/engine/combat/EquipmentService';
import { EmptyEquipment } from '../src/client/game/shardfile/emptyEquipment';
import { wirePage } from '../src/client/game/shardfile/wirePage';
import { EnteredEquipment } from '../src/client/game/grid/enteredEquipment';
import { enterDataCellKit } from '../src/client/game/grid/dataCellKit';
import type { RegionalRuntimePage } from '../src/client/game/grid/regionalRuntime';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { builtFolder } from '../src/test/game/builtFolder';

// TEMPLATE-E2E TC-SHIP-e2 (opus-te2e7, 2026-11-17): after a reload on staging v0.1.34 the Template's taken sword stayed off the
// hotbar: the server's `weapon.sword-iron.taken` line was 1, but the grid data cell's kit matched its racked rows by the
// weapon's page id (`declared.weapon.sword-iron`), never by the row's (`weapon.sword-iron`), so only the take itself, never a
// taken line read at entry, brought it to hand. A taken line read at entry now unlocks it and puts it in hand.
test('a data cell\'s racked sword comes to hand from the server\'s taken line, as after a reload', { timeout: 60_000 }, async () => {
  const template = (await loadHeadlessFolder(builtFolder('_template'))).shardfile, scope = new Scope('data-cell-rack');
  const systems: { id: string; run: (dt: number, t: number) => void }[] = [];
  const input = { bind: () => undefined, held: () => false, register: () => undefined, has: () => true, bindings: { describe: () => undefined } };
  const road = new EquipmentService(new EmptyEquipment(), { scope });
  // the server's wire as the worker client binds it on the page's controls: every call a held item makes is heard and dropped
  const wire = new Proxy({}, { get: (_held, key) => key === 'then' ? undefined : () => undefined });
  road.bindWire(wire as Parameters<EquipmentService['bindWire']>[0]);
  const controls = new EnteredEquipment(road);
  const app = { input, events: undefined, equipmentHost: { viewmodel: new Group() }, combat: { targets: () => [] }, effects: null, player: null, state: 'play', get equipment() { return controls.service; },
    addContentSystem: (spec: { id: string; run: (dt: number, t: number) => void }, owner: Scope) => { systems.push(spec); owner.onDispose(() => { systems.splice(systems.indexOf(spec), 1); }); } };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The kit reads only the page's controls, camera, player and app.
  const page = { equipment: controls, world: { game: { camera: new PerspectiveCamera() }, player: { position: new Vector3() } }, play: {}, context: { app } } as unknown as RegionalRuntimePage;
  expect(await enterDataCellKit(template, new Map(), page, scope.child('entry'))).not.toBeNull();
  const rows = (): string[] => controls.service.available.map(weapon => weapon.row.id);
  // on its rack: the loadout's whip is in hand and the sword is not on the hotbar
  expect(controls.service.current.row.id).not.toBe('weapon.sword-iron');
  expect(rows()).not.toContain('weapon.sword-iron');
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The wire's owned lines are all the kit reads of the client.
  wirePage.client = { owned: new Map([['weapon.sword-iron.taken', 1]]) } as unknown as NonNullable<typeof wirePage.client>;
  try {
    // two seconds of frames: the swap to it plays out
    for (let frame = 1; frame <= 120; frame++) for (const system of systems) system.run(1 / 60, frame / 60);
    expect(rows()).toContain('weapon.sword-iron');
    expect(controls.service.current.row.id).toBe('weapon.sword-iron');
  } finally { wirePage.client = null; }
  scope.dispose();
});
