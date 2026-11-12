// @vitest-environment happy-dom
// REMOTE-PLAYERS RP2 (Jake, 2026-11-12: "Jimmy doesn't have a character model"): another player enters as the castaway body,
// dressed at once from one shared build, standing 1.75 to 1.85 m with its soles on the ground, every joint pose() drives,
// and a right-hand mount for the held item. Before RP2 it waited on the practice dummy's GLB and stayed undressed here.
import * as THREE from 'three';
import { expect, test } from 'vitest';
import { Scope } from '../../../shared/engine/app/scope';
import { PLAYER_CLASS } from '../../../shared/engine/net/netSchemas';
import { DUMMY_JOINTS } from '../practice/TrainingDummy';
import type { NetClient } from './client';
import { OtherPlayers } from './otherPlayers';

/** A client with this page at handle 1 and the named others, each row at the origin. */
function clientWith(names: readonly string[]): NetClient {
  const entities = new Map(names.map((name, at) => [at + 2, { handle: at + 2, id: `player-${name}`, cls: PLAYER_CLASS, initial: { name } }]));
  return { welcome: { handle: 1 }, entities, riders: new Map(), interpolator: { sample: (_handle: number, _tick: number, row: Float64Array) => { row.fill(0); return true; } } } as unknown as NetClient;
}

const skinned = (root: THREE.Object3D): THREE.SkinnedMesh[] => { const found: THREE.SkinnedMesh[] = []; root.traverse(node => { if ('isSkinnedMesh' in node) found.push(node as THREE.SkinnedMesh); }); return found; };

test('another player enters dressed as the castaway body, at a player\'s height, soles on the ground', () => {
  const scene = new THREE.Scene(), scope = new Scope('rp2-test'), others = new OtherPlayers(clientWith(['Jimmy', 'Ana']), scene, scope);
  others.frame(0, 1 / 60);
  const shown = others.shown;
  expect(shown.map(body => [body.name, body.modelled, body.model])).toEqual([['Jimmy', true, 'castaway'], ['Ana', true, 'castaway']]);

  const groups = scene.children.filter(node => node.name.startsWith('Player · '));
  expect(groups).toHaveLength(2);
  const [jimmy, ana] = groups.map(group => skinned(group));
  expect(jimmy).toHaveLength(1);
  // One build, shared: both bodies draw the same geometry and material, each on its own skeleton.
  expect(jimmy?.[0]?.geometry).toBe(ana?.[0]?.geometry);
  expect(jimmy?.[0]?.material).toBe(ana?.[0]?.material);
  expect(jimmy?.[0]?.skeleton).not.toBe(ana?.[0]?.skeleton);

  const group = groups[0], mesh = jimmy?.[0];
  if (group === undefined || mesh === undefined) throw new Error('no body');
  group.updateMatrixWorld(true); mesh.computeBoundingBox();
  const box = new THREE.Box3().copy(mesh.boundingBox ?? new THREE.Box3()).applyMatrix4(mesh.matrixWorld);
  expect(box.min.y).toBeGreaterThan(-0.03);
  expect(box.min.y).toBeLessThan(0.03);
  expect(box.max.y - box.min.y).toBeGreaterThanOrEqual(1.75);
  expect(box.max.y - box.min.y).toBeLessThanOrEqual(1.85);

  const bones = new Set(mesh.skeleton.bones.map(bone => bone.name));
  for (const joint of DUMMY_JOINTS) expect(bones.has(joint.charAt(0).toUpperCase() + joint.slice(1))).toBe(true);
  expect(group.getObjectByName('RightHandMount')?.parent?.name).toBe('RightHand');
  expect(group.getObjectByName('GroundContact')).toBeDefined();
  // A body that leaves frees its own skeleton, never the mesh every other body shares.
  const freed: string[] = [];
  mesh.geometry.addEventListener('dispose', () => { freed.push('geometry'); });
  for (const material of [mesh.material].flat()) material.addEventListener('dispose', () => { freed.push('material'); });
  mesh.skeleton.dispose = () => { freed.push('skeleton'); };
  scope.dispose();
  expect(freed).toEqual(['skeleton']);
});
