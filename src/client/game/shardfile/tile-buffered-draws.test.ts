import { expect, it } from 'vitest';
import { Group, Mesh, MeshBasicMaterial, SphereGeometry } from 'three';
import { parseSceneBuffers } from '@wildshard/format/sceneBuffers';
import { Scope } from '@wildshard/engine/app/scope';
import { tileBufferedDraws } from './tileBufferedDraws';
import { tileKey } from './tileContent';
import { tileOf } from '../../../shared/game/shardfile/tileOrder';

it('retains authored order, shared edge ownership and transformed LOD bounds', async () => {
  const root = new Group(), near = new Group(), far = new Group(), unbounded = new Group();
  near.position.x = -125; far.position.x = 75; root.position.z = 62.5; root.scale.setScalar(2);
  root.add(near, far, unbounded); root.updateMatrixWorld(true);
  const rows = parseSceneBuffers({ version: 1, buffers: [{ id: 'p', file: 'position.bin', storage: 'f32', byteLength: 12 }], attributes: [{ id: 'p', buffer: 'p', size: 3 }], geometries: [
    { id: 'near', attributes: { position: 'p' }, sphere: [0, 0, 0, 4] },
    { id: 'far', attributes: { position: 'p' }, sphere: [0, 0, 0, 4] },
    { id: 'unbounded', attributes: { position: 'p' } },
  ], draws: [
    { id: 'a', at: [-125, 0, 0], levels: [{ from: 0, draw: { kind: 'mesh', geometry: 'near' } }, { from: 20 }] },
    { id: 'b', at: [125, 0, 0], draw: { kind: 'mesh', geometry: 'far', at: [-50, 0, 0] } },
    { id: 'c', draw: { kind: 'mesh', geometry: 'unbounded' } },
  ] });
  const content = tileBufferedDraws('field', root, rows);
  if (content === null) throw new Error('Missing bounded content');
  expect(root.children).toEqual([unbounded]);
  const a = new Scope('a'), b = new Scope('b'), c = new Scope('c');
  await content.attach(tileKey(tileOf(149, 60)), c);
  await content.attach(tileKey(tileOf(-249, 60)), a);
  await content.attach(tileKey(tileOf(-249, 65)), b);
  expect(root.children).toEqual([near, far, unbounded]);
  a.dispose(); expect(root.children).toContain(near);
  b.dispose(); expect(root.children).toEqual([far, unbounded]);
  c.dispose(); expect(root.children).toEqual([unbounded]);
});

it('leaves uncullable resources whole and ignores a retired tile scope', async () => {
  const root = new Group(), shape = new SphereGeometry(), material = new MeshBasicMaterial();
  root.add(new Mesh(shape, material)); root.updateMatrixWorld(true);
  const rows = parseSceneBuffers({ version: 1, buffers: [{ id: 'p', file: 'position.bin', storage: 'f32', byteLength: 12 }], attributes: [{ id: 'p', buffer: 'p', size: 3 }], geometries: [
    { id: 'g', attributes: { position: 'p' }, sphere: [0, 0, 0, 1] },
  ], draws: [{ id: 'draw', draw: { kind: 'mesh', geometry: 'g', frustum: false } }] });
  expect(tileBufferedDraws('uncullable', root, rows)).toBeNull();
  expect(root.children).toHaveLength(1);
  const first = rows.draws[0]?.draw;
  if (first === undefined) throw new Error('Missing draw');
  first.frustum = true;
  const content = tileBufferedDraws('bounded', root, rows), retired = new Scope('retired'); retired.dispose();
  await content?.attach(36, retired); expect(root.children).toHaveLength(0);
  shape.dispose(); material.dispose();
});
