// FORMAT-PRUNE FP40 (J439 board): one legacy zone's far view as the grid draws it (`installFarProxy`, its own far.json look),
// with its G539 impostor and without it, from a neighbour's road at a far-ring distance. Driven by far-impostor-shots.mjs.
import { BufferGeometry, Color, DirectionalLight, Group, HemisphereLight, Mesh, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { prepareRigLoader } from '@wildshard/engine/anim/rig';
import { CHUNK_HALF } from '@wildshard/engine/core/config';
import { installFarProxy } from '../src/client/game/grid/farView';
import { decodeFarImpostor, farBandShare } from '../src/client/game/grid/farImpostorView';
import type { FarLookRuntime } from '../src/shared/game/grid/farProxy';

interface View { readonly slug: string; readonly impostor: boolean; readonly distance: number; readonly width: number; readonly height: number; readonly fov: number }
type Row = { far: { impostor?: Parameters<typeof decodeFarImpostor>[0] }; look: FarLookRuntime };

const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
document.body.style.margin = '0';
document.body.append(renderer.domElement);

async function bytes(path: string): Promise<Uint8Array> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path}: ${String(response.status)}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function view(v: View): Promise<{ share: number; impostor: boolean }> {
  const base = `/assets/baked/${v.slug}`, row = JSON.parse(new TextDecoder().decode(await bytes(`${base}/far.json`))) as Row;
  const gltf = await (await prepareRigLoader()).createRigLoader().parseAsync((await bytes(`${base}/far.glb`)).slice().buffer, '');
  let geometry: BufferGeometry | undefined;
  gltf.scene.traverse(node => { if (geometry === undefined && node instanceof Mesh) geometry = node.geometry as BufferGeometry; });
  if (geometry === undefined) throw new Error(`${v.slug}: far.glb has no mesh`);
  const impostor = v.impostor && row.far.impostor !== undefined ? await decodeFarImpostor(row.far.impostor, await bytes(`${base}/far-impostor.png`)) : null;
  const scene = new Scene(), root = new Group();
  scene.background = new Color(...row.look.haze.colour);
  scene.add(new HemisphereLight(0xdfe8ff, 0x55504a, 1.4));
  const sun = new DirectionalLight(0xfff2dd, 2.2); sun.position.set(-0.4, 1, 0.3); scene.add(sun);
  scene.add(root);
  const installed = installFarProxy(root, geometry, row.look, false, undefined, false, impostor);
  // the grid's rule: the share is read from the distance past the cell's edge (session.ts `bands`); without an impostor
  // the proxy draws at every distance
  const share = farBandShare(v.distance);
  installed.band?.(share);
  // the traveller stands on a neighbour's road, due south of the cell, eye 1.7 m over a 2 m road, looking at its centre
  const camera = new PerspectiveCamera(v.fov, v.width / v.height, 1, 20_000);
  camera.position.set(0, 3.7, CHUNK_HALF + v.distance); camera.lookAt(0, 20, 0);
  renderer.setPixelRatio(1); renderer.setSize(v.width, v.height);
  renderer.render(scene, camera);
  installed.dispose();
  return { share, impostor: impostor !== null };
}

(globalThis as unknown as { __farShots: unknown }).__farShots = { view };
