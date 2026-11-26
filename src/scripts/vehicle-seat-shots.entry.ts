// MIRROR-SALT-ZONE MSZ10: what a second page draws of players seated in the vehicles example's buggy (a driver and a passenger,
// `sit`) and land-sail (a driver, `stand`), through the page's own `OtherPlayers` and a fake client. The kinds are the example's
// builders (sharddev packages/sdk/src/shards/vehicles/generators/world.ts), each seat's row at its seat in the world frame as
// the server leads a rider there. `__seatShots.drive(s)` moves every vehicle and its riders on along its heading at 15 m/s.
import * as THREE from 'three';
import { Scope } from '../shared/engine/app/scope';
import { PLAYER_CLASS } from '../shared/engine/net/netSchemas';
import type { NetClient } from '../client/engine/net/client';
import { OtherPlayers, type OtherSeat } from '../client/engine/net/otherPlayers';

const column = (name: string): number => PLAYER_CLASS.row.findIndex(entry => entry.name === name);
const X = column('x'), Y = column('y'), Z = column('z'), YAW = column('yaw'), HP = column('hp');
const ROAD_X = column('roadX'), ROAD_Z = column('roadZ');
const UP = new THREE.Vector3(0, 1, 0);
const material = (color: string, side: THREE.Side = THREE.FrontSide): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color, roughness: 0.8, side });
const red = material('#b5402a'), teal = material('#2f8f8a', THREE.DoubleSide), wood = material('#7a5634'), tyre = material('#1d1d1d');

function buggy(): THREE.Group {
  const part = new THREE.Group(), tub = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.7, 3.4), red); tub.position.set(0, 0.75, 0); part.add(tub);
  for (const [x, z] of [[-1, -1.2], [1, -1.2], [-1, 1.2], [1, 1.2]] as const) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.3, 16), tyre); wheel.rotation.z = Math.PI / 2; wheel.position.set(x, 0.4, z); part.add(wheel);
  }
  return part;
}
function landSail(): THREE.Group {
  const part = new THREE.Group(), deck = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.25, 3.6), wood); deck.position.set(0, 0.7, 0); part.add(deck);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 5, 8), wood); mast.position.set(0, 3.2, -0.6); part.add(mast);
  const sail = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 3.6), teal); sail.position.set(0, 3.4, 0.2); sail.rotation.y = Math.PI / 2; part.add(sail);
  return part;
}

interface Vehicle { readonly look: THREE.Group; readonly at: THREE.Vector3; readonly yaw: number }
interface Rider { readonly handle: number; readonly id: string; readonly name: string; readonly vehicle: Vehicle; readonly seat: readonly [number, number, number]; readonly pose: OtherSeat['pose'] }

const width = 960, height = 720;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(width, height); renderer.setPixelRatio(1); renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.style.margin = '0'; document.body.append(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color('#b9d4e6'); scene.fog = new THREE.Fog('#b9d4e6', 60, 220);
scene.add(new THREE.HemisphereLight('#e8f2ff', '#c9bfa8', 1.6));
const sun = new THREE.DirectionalLight('#fff4e0', 2.2); sun.position.set(-20, 30, 12); scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), material('#e8e2d4')); ground.rotation.x = -Math.PI / 2; scene.add(ground);

const vehicles: Vehicle[] = [{ look: buggy(), at: new THREE.Vector3(-3, 0, 0), yaw: 0.35 }, { look: landSail(), at: new THREE.Vector3(4, 0, -2), yaw: 0.2 }];
const [car, sail] = vehicles as [Vehicle, Vehicle];
for (const vehicle of vehicles) scene.add(vehicle.look);
// each rider looks off to the side (their row's yaw): the body faces the vehicle's heading all the same
const riders: Rider[] = [
  { handle: 2, id: 'player-jimmy', name: 'Jimmy', vehicle: car, seat: [-0.45, 0.9, 0.3], pose: 'sit' },
  { handle: 3, id: 'player-ana', name: 'Ana', vehicle: car, seat: [0.45, 0.9, 0.3], pose: 'sit' },
  { handle: 4, id: 'player-kai', name: 'Kai', vehicle: sail, seat: [0, 0.83, 1.2], pose: 'stand' },
];
const seatAt = (rider: Rider): THREE.Vector3 => new THREE.Vector3(...rider.seat).applyAxisAngle(UP, rider.vehicle.yaw).add(rider.vehicle.at);
const entities = new Map(riders.map(rider => [rider.handle, { handle: rider.handle, id: rider.id, cls: PLAYER_CLASS, initial: { name: rider.name } }]));
const client = {
  welcome: { handle: 1 }, entities, riders: new Map(),
  interpolator: { sample: (handle: number, _tick: number, row: Float64Array) => {
    const rider = riders.find(one => one.handle === handle); if (rider === undefined) return false;
    const at = seatAt(rider); row.fill(0); row[ROAD_X] = Number.NaN; row[ROAD_Z] = Number.NaN;
    row[X] = at.x; row[Y] = at.y; row[Z] = at.z; row[YAW] = rider.vehicle.yaw + 1.1; row[HP] = 100; return true;
  } },
} as unknown as NetClient;
const others = new OtherPlayers(client, scene, new Scope('msz10-shots'));
others.seats = id => { const rider = riders.find(one => one.id === id); return rider === undefined ? null : { yaw: rider.vehicle.yaw, pose: rider.pose }; };
const camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 400);
let tick = 0;
const place = (vehicle: Vehicle): void => { vehicle.look.position.copy(vehicle.at); vehicle.look.rotation.y = vehicle.yaw; };
function frame(dt: number): void { for (const vehicle of vehicles) place(vehicle); others.frame(tick++, dt); }
for (let i = 0; i < 30; i++) frame(1 / 60);

Object.defineProperty(globalThis, '__seatShots', { value: {
  /** Aim the second page's eye (a standing player's, 1.6 m) from `from` at `at`, offsets from the buggy, and draw. */
  view(from: readonly [number, number, number], at: readonly [number, number, number]): void {
    camera.position.copy(car.at).add(new THREE.Vector3(...from)); camera.lookAt(car.at.clone().add(new THREE.Vector3(...at)));
    renderer.render(scene, camera);
  },
  /** Every vehicle and its riders on along its heading (-z turned by its yaw) at 15 m/s for `seconds`. */
  drive(seconds: number): void {
    for (let i = 0; i < seconds * 60; i++) { for (const vehicle of vehicles) vehicle.at.add(new THREE.Vector3(0, 0, -15 / 60).applyAxisAngle(UP, vehicle.yaw)); frame(1 / 60); }
  },
  shown: () => others.shown.map(body => ({ name: body.name, seated: body.seated, gait: body.gait, speed: body.speed, item: body.item })),
} });
