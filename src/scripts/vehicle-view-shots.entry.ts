// MIRROR-SALT-ZONE MSZ11: the view from a vehicle's seat, as the page's `SeatEye` poses the camera (src/client/game/plugin/
// seatView.ts): from the stand-in buggy's driver seat (the vehicles example's seat, `sit`) at rest and at the boosted top
// speed, from the land-sail's deck (`stand`), and the chase view on open ground and backed against a wall. The vehicles are
// the vehicles example's shapes (sharddev packages/sdk/src/shards/vehicles/generators/world.ts) with a bonnet and a wheel, as
// MSZ22's buggy will have; a row of marker posts down the flat shows the field of view.
// MSZ14b: a worn buggy's smoke and a wrecked one's break-apart (`VehicleFx`), from a fixed spot beside it.
import * as THREE from 'three';
import { Scope } from '@wildshard/engine/app/scope';
import { SEAT_PITCH, SeatEye, type SeatNow } from '../client/game/plugin/seatView';
import { panelColours } from '../client/game/plugin/followedVehicles';
import { VehicleFx } from '../client/game/plugin/vehicleFx';
import type { MoverPose } from '@wildshard/format/moverPose';

const material = (color: string, side: THREE.Side = THREE.FrontSide): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color, roughness: 0.8, side });
const red = material('#b5402a'), teal = material('#2f8f8a', THREE.DoubleSide), wood = material('#7a5634'), tyre = material('#1d1d1d'), steel = material('#5b5f66');
const mesh = (geometry: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh => { const m = new THREE.Mesh(geometry, mat); m.position.set(x, y, z); return m; };

/** The example's buggy (a 1.9 × 0.7 × 3.4 tub) with a bonnet ahead of the seats, a dash and a wheel before the driver. */
function buggy(): THREE.Group {
  const part = new THREE.Group();
  part.add(mesh(new THREE.BoxGeometry(1.9, 0.7, 3.4), red, 0, 0.75, 0));
  part.add(mesh(new THREE.BoxGeometry(1.7, 0.22, 1.2), red, 0, 1.21, -1.1)); // the bonnet
  part.add(mesh(new THREE.BoxGeometry(1.8, 0.2, 0.14), steel, 0, 1.2, -0.45)); // the dash
  const column = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 8), steel, -0.45, 1.22, -0.33); column.rotation.x = 1.0; part.add(column);
  const wheel = mesh(new THREE.TorusGeometry(0.18, 0.025, 8, 24), tyre, -0.45, 1.33, -0.2); wheel.rotation.x = -0.5; part.add(wheel);
  for (const [x, z] of [[-1, -1.2], [1, -1.2], [-1, 1.2], [1, 1.2]] as const) {
    const tire = mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.3, 16), tyre, x, 0.4, z); tire.rotation.z = Math.PI / 2; part.add(tire);
  }
  return part;
}
/** The example's land-sail, with a tiller at the stern. */
function landSail(): THREE.Group {
  const part = new THREE.Group();
  part.add(mesh(new THREE.BoxGeometry(1.2, 0.25, 3.6), wood, 0, 0.7, 0));
  part.add(mesh(new THREE.CylinderGeometry(0.06, 0.08, 5, 8), wood, 0, 3.2, -0.6));
  const sail = mesh(new THREE.PlaneGeometry(2.2, 3.6), teal, 0, 3.4, 0.2); sail.rotation.y = Math.PI / 2; part.add(sail);
  const tiller = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 8), wood, 0.35, 1.2, 1.0); tiller.rotation.x = 1.1; part.add(tiller);
  return part;
}

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.style.margin = '0'; document.body.append(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color('#b9d4e6'); scene.fog = new THREE.Fog('#b9d4e6', 80, 300);
scene.add(new THREE.HemisphereLight('#e8f2ff', '#c9bfa8', 1.6));
const sun = new THREE.DirectionalLight('#fff4e0', 2.2); sun.position.set(-20, 30, 12); scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(800, 800), material('#e8e2d4')); ground.rotation.x = -Math.PI / 2; scene.add(ground);
// marker posts every 10 m down both sides of the line ahead (the view's width reads off them), and a wall behind the yard
for (let z = -10; z >= -200; z -= 10) for (const x of [-6, 6]) scene.add(mesh(new THREE.BoxGeometry(0.4, 2.4, 0.4), z % 50 === 0 ? red : steel, x, 1.2, z));
const wall = mesh(new THREE.BoxGeometry(14, 6, 1), material('#a89a80'), 0, 3, 7); scene.add(wall);

const car = buggy(), sail = landSail();
scene.add(car, sail); sail.position.set(5, 0, -3); sail.rotation.y = 0.1;
const carPose: MoverPose = { position: { x: 0, y: 0, z: 0 }, euler: { x: 0, y: 0, z: 0 }, enabled: true };
const sailPose: MoverPose = { position: { x: 5, y: 0, z: -3 }, euler: { x: 0, y: 0.1, z: 0 }, enabled: true };
const HANDLING = { speed: 20, boost: 1.5 } as const;
/** The deck's standing place, off the mast's line by the tiller (the example's [0, 0.83, 1.2] stands right behind the mast,
 *  which fills the middle of the view: MSZ22's sail stands its driver here). */
const SAIL_SEAT = [0.55, 0.83, 1.6] as const;

let seat: SeatNow = { pose: carPose, at: [-0.45, 0.9, 0.3], sit: 'sit', speed: 0, handling: HANDLING }, chase = false;
const look = { yaw: 0, pitch: SEAT_PITCH };
/** The wall behind the yard is what a chase arm meets: a ray against its front face (z = 6.5). */
const clear = (from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }): number => {
  const length = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
  if (to.z <= 6.5 || from.z >= 6.5) return length;
  return length * (6.5 - from.z) / (to.z - from.z);
};
const eye = new SeatEye({ seat: () => seat, look, chase: () => chase, clear });
const camera = new THREE.PerspectiveCamera(72, 1, 0.05, 600);

Object.defineProperty(globalThis, '__viewShots', { value: {
  /** Draw one view at `width` × `height`: the vehicle (`buggy` or `sail`) at `z`, moving at `speed` m/s, chase or seat. */
  view(o: { readonly width: number; readonly height: number; readonly vehicle: 'buggy' | 'sail'; readonly z: number; readonly speed: number; readonly chase: boolean; readonly yaw?: number }): { fov: number; zoom: number; widen: number; eye: number[] } {
    renderer.setSize(o.width, o.height); camera.aspect = o.width / o.height;
    // the held weapon's base fov (Hor+ on a portrait phone: `fovForAspect(72, aspect)`)
    camera.fov = camera.aspect >= 1 ? 72 : THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(72) / 2) / Math.sqrt(camera.aspect)));
    camera.zoom = 1; camera.updateProjectionMatrix();
    const pose = o.vehicle === 'buggy' ? carPose : sailPose, look3d = o.vehicle === 'buggy' ? car : sail;
    pose.position.z = o.z; look3d.position.z = o.z; look.yaw = (o.yaw ?? 0) + pose.euler.y;
    seat = o.vehicle === 'buggy' ? { pose, at: [-0.45, 0.9, 0.3], sit: 'sit', speed: o.speed, handling: HANDLING } : { pose, at: SAIL_SEAT, sit: 'stand', speed: o.speed, handling: HANDLING };
    chase = o.chase;
    for (let i = 0; i < 240; i++) eye.pose(camera, 1 / 60); // the chase arm eases out to its length
    renderer.render(scene, camera);
    const shown = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / camera.zoom));
    return { fov: Math.round(shown * 10) / 10, zoom: Math.round(camera.zoom * 1000) / 1000, widen: Math.round(eye.widen * 10) / 10, eye: camera.position.toArray().map(v => Math.round(v * 100) / 100) };
  },
  /** MSZ14b: the buggy 12 m down the flat, seen from beside and behind it: worn (smoking for `seconds`), or wrecked `seconds`
   *  ago (gone, broken apart where it stood). Returns the points alive. */
  wreck(o: { readonly width: number; readonly height: number; readonly state: 'worn' | 'wrecked'; readonly seconds: number }): { puffs: number; chunks: number } {
    renderer.setSize(o.width, o.height); camera.aspect = o.width / o.height; camera.fov = 60; camera.zoom = 1; camera.updateProjectionMatrix();
    const scope = new Scope('wreck-shots'), fx = new VehicleFx(scene, scope, 7), worn = o.state === 'worn', smoking = new Set(worn ? ['car'] : []);
    carPose.position.z = -12; car.position.z = -12; car.visible = worn; sail.visible = false;
    camera.position.set(5, 2.4, -3); camera.lookAt(0, 2.2, -12);
    if (!worn) fx.burst(carPose, panelColours(car));
    for (let t = 0; t < o.seconds; t += 1 / 60) { if (worn) fx.smokeFrom('car', carPose, 1 / 60); fx.frame(1 / 60, smoking); }
    renderer.render(scene, camera);
    const live = fx.live();
    scope.dispose(); car.visible = true; sail.visible = true;
    return { ...live };
  },
} });
