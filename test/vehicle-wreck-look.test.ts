// @vitest-environment happy-dom
// oxlint-disable-next-line import/no-nodejs-modules -- Runs the shipped physics module and reads the example's section.
import { readFileSync } from 'node:fs';
import { parseVehicles } from '@wildshard/format/vehicles';
import type { MoverPose } from '@wildshard/format/moverPose';
import * as THREE from 'three';
import { expect, test } from 'vitest';
import { Scope } from '../src/shared/engine/app/scope';
import { createSimHost } from '../src/server/engine/sim';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { FollowedVehicles, panelColours, panelLook } from '../src/client/game/plugin/followedVehicles';
import { VehicleFx } from '../src/client/game/plugin/vehicleFx';
import { playerVehicle, vehicleWornRow, vehicleWreckRow } from '../src/shared/game/shardfile/wirePrompts';
import { SIM_LEVEL } from './fixtures/sim-level/level';
import { VEHICLES_EXAMPLE } from './fixtures/vehiclesExample';

// MIRROR-SALT-ZONE MSZ14b: how a hurt vehicle looks on a page. A worn one (its `vehicleWornRow` up) smokes; when a vehicle's row
// leaves, its drawn panel hides (before, it stayed at its last pose), and when the wreck row is up as it leaves, it breaks apart
// where it stood; a per-player vehicle that only despawned goes quietly. A vehicle back from either shows the same panel again.
test('a worn vehicle smokes, a gone one\'s panel hides, a wrecked one breaks apart, and one back shows again', async () => {
  const vehicles = parseVehicles(JSON.parse(readFileSync(VEHICLES_EXAMPLE, 'utf8')));
  const level = { ...SIM_LEVEL, entities: [], ground: { size: 160, height: 0 } };
  const page = createSimHost(level, { rapier: await loadRapier(readFileSync('public/assets/physics/rapier.wasm')) });
  const scope = new Scope('vehicle-wreck-look-test'), root = new THREE.Group();
  try {
    // the kinds' library panels, as a page's props have them (drawn nowhere themselves)
    const panels = new Map(vehicles.kinds.map(kind => { const panel = new THREE.Group(); panel.visible = false; root.add(panel); return [kind.panel, panel] as const; }));
    const fx = new VehicleFx(root, scope), bursts: MoverPose[] = [];
    const followed = new FollowedVehicles(vehicles, { physics: page.physics, scope, look: panelLook(panels, scope), fx: { ...fx, smokeFrom: fx.smokeFrom.bind(fx), frame: fx.frame.bind(fx), burst: pose => { bursts.push(pose); fx.burst(pose); } } });
    const me = 'actor.me', buggy = playerVehicle('yard.buggy', me), feet = { x: 0, z: 0 };
    const drawn = (): THREE.Object3D[] => root.children.filter(child => child.visible && !child.name.startsWith('vehicle-'));
    const at = (z: number): MoverPose => ({ position: { x: -6, y: 0, z }, euler: { x: 0, y: 0, z: 0 }, enabled: true });
    // the shared sail stands at its dock; the player's buggy comes with its first row
    followed.sync(['script:line.sail'], me, feet); followed.frame(1 / 60);
    followed.view(buggy)?.pose(at(20), {}); followed.sync(['script:line.sail', `script:${buggy}`], me, feet);
    expect(drawn()).toHaveLength(2); // the sail's panel copy, at its dock from the start, and the buggy's
    // worn: it smokes, and stops when the row goes
    followed.sync(['script:line.sail', `script:${buggy}`, `state:${vehicleWornRow(buggy)}`], me, feet);
    for (let i = 0; i < 90; i++) followed.frame(1 / 60);
    expect(fx.live().puffs).toBeGreaterThan(10);
    // wrecked: its row leaves with the wreck row up; the panel hides and it breaks apart where it stood
    followed.view(buggy)?.pose(at(5), {});
    followed.sync(['script:line.sail', `state:${vehicleWreckRow(buggy)}`], me, feet); followed.frame(1 / 60);
    expect(followed.ids()).not.toContain(buggy);
    expect(drawn()).toHaveLength(1); // the sail's alone
    expect(bursts.map(pose => pose.position.z)).toEqual([5]);
    expect(fx.live().chunks).toBeGreaterThan(30);
    for (let i = 0; i < 300; i++) followed.frame(1 / 60);
    expect(fx.live()).toEqual({ puffs: 0, chunks: 0 }); // the smoke and the burst have settled
    // back from its dock: the same panel shows again; a despawn later (no wreck row) hides it with no burst
    followed.view(buggy)?.pose(at(20), {}); followed.sync(['script:line.sail', `script:${buggy}`], me, feet);
    expect(drawn()).toHaveLength(2);
    expect(root.children.filter(child => !child.name.startsWith('vehicle-'))).toHaveLength(vehicles.kinds.length + 2); // no second copy
    followed.sync(['script:line.sail'], me, feet); followed.frame(1 / 60);
    expect(drawn()).toHaveLength(1);
    expect(bursts).toHaveLength(1);
  } finally { scope.dispose(); page.dispose(); }
});

test('a wreck\'s chunks take the panel\'s main colours, most used first', () => {
  const panel = new THREE.Group(), box = new THREE.BoxGeometry(), red = new THREE.MeshStandardMaterial({ color: '#ff0000' }), grey = new THREE.MeshStandardMaterial({ color: '#808080' });
  panel.add(new THREE.Mesh(box, grey), new THREE.Mesh(box, red), new THREE.Mesh(box, red));
  const [first, second] = panelColours(panel);
  expect(first).toEqual([1, 0, 0]);
  expect(second?.[0]).toBeCloseTo(new THREE.Color('#808080').r, 5);
});
