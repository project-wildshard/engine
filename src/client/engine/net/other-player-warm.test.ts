// @vitest-environment happy-dom
// NET-LAG NL4 (Jake's 60 ms frames in Driftwood): the first other player to come into view linked its body's programs inside that
// frame (4 programs in a 200 ms frame, 20 in a 440 ms one, desktop Chromium on Metal). A page in the world draws one body of the
// same build from the start, under the world and never culled, holding every item of the lent kit, so the in-play warm-up links
// those programs paced and a body that enters later draws with programs already built: the same materials, the same keys.
import * as THREE from 'three';
import { afterEach, expect, test } from 'vitest';
import { Scope } from '../../../shared/engine/app/scope';
import { PLAYER_CLASS } from '../../../shared/engine/net/netSchemas';
import type { NetClient } from './client';
import { heldOnOthers, slotKit, kitSlots } from './heldOnOthers';
import { OtherPlayers } from './otherPlayers';

const column = (name: string): number => PLAYER_CLASS.row.findIndex(entry => entry.name === name);
const HELD = column('held');
const entities = new Map<number, unknown>();
const client = { welcome: { handle: 1 }, entities, riders: new Map(), interpolator: { sample: (_handle: number, _tick: number, out: Float64Array) => { out.fill(0); out[HELD] = 0; return true; } } } as unknown as NetClient;
const materials = (root: THREE.Object3D | undefined): Set<THREE.Material> => { const found = new Set<THREE.Material>(); root?.traverse(node => { if ('isMesh' in node || 'isSprite' in node) for (const material of [(node as THREE.Mesh).material].flat()) found.add(material); }); return found; };
let unlend: () => void = () => undefined;
afterEach(() => { unlend(); entities.clear(); });

test('a page in the world draws a warm body from the start: under the world, never culled, the same materials a player brings', () => {
  const scene = new THREE.Scene(), scope = new Scope('test');
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.8, 0.012), new THREE.MeshStandardMaterial()), sword = new THREE.Group();
  blade.name = 'sword_wood'; sword.add(blade);
  unlend = heldOnOthers.lend(slotKit(() => kitSlots(new Map(), ['weapon.sword']), row => ({ row, model: sword, bow: false })));
  const others = new OtherPlayers(client, scene, scope);
  for (let at = 0; at < 17; at++) others.frame(at, 1 / 60);
  const warm = scene.getObjectByName('other-player-warm');
  expect(warm).toBeDefined();
  expect(warm?.position.y).toBeLessThan(-100);
  const nodes: THREE.Object3D[] = [];
  warm?.traverse(node => { nodes.push(node); });
  expect(nodes.some(node => node instanceof THREE.SkinnedMesh)).toBe(true);
  expect(nodes.every(node => !node.frustumCulled)).toBe(true);
  expect(nodes.every(node => node.visible || node.name === 'Talking')).toBe(true);
  // a body that enters later draws with the same materials (so three keys the same programs), its held sword included
  entities.set(2, { handle: 2, id: 'player-jimmy', cls: PLAYER_CLASS, initial: { name: 'Jimmy' } });
  others.frame(1, 1 / 60);
  const jimmy = scene.getObjectByName('Player · Jimmy'), warmed = materials(warm), deck = jimmy?.getObjectByName('RemoteHoverboard');
  // the body, its disc and its held item are the very materials; its deck builds its own, of the warm deck's kinds
  const own = materials(deck), kinds = (set: Set<THREE.Material>): string[] => [...set].map(material => material.type).sort();
  expect([...materials(jimmy)].filter(material => !(material instanceof THREE.SpriteMaterial) && !own.has(material)).every(material => warmed.has(material))).toBe(true);
  expect(kinds(materials(warm?.getObjectByName('RemoteHoverboard')))).toEqual(kinds(own));
  expect(warm?.getObjectByName('RemoteHoverboard')?.visible).toBe(true);
  expect([...warmed].some(material => material === blade.material || (warm?.getObjectByName('sword_wood') as THREE.Mesh | undefined)?.material === material)).toBe(true);
  // it is not a player: the proofs' list and the minimap see Jimmy alone
  expect(others.shown.map(body => body.name)).toEqual(['Jimmy']);
  scope.dispose();
  expect(scene.getObjectByName('other-player-warm')).toBeUndefined();
});
