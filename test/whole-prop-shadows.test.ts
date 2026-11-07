import { expect, test } from 'vitest';
import { BufferAttribute, BufferGeometry, Group, Matrix4, Mesh, MeshStandardMaterial } from 'three';
import { Scope } from '../src/shared/engine/app/scope';
import { installDeclaredProps } from '../src/client/engine/world/declaredProps';
import { bakeProps } from '../src/sharddev/bake/props';

test.each([undefined, false, true])('whole tile rendering preserves explicit receiveShadow=%s and its default', async receiveShadow => {
  const geometry = new BufferGeometry(), material = new MeshStandardMaterial(), scope = new Scope('whole-shadow');
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
  geometry.computeVertexNormals();
  try {
    const baked = bakeProps({ static: new Group(), whole: [{ id: 'whole', mesh: new Mesh(geometry, material), transform: new Matrix4(),
      partition: 'runs', ...(receiveShadow === undefined ? {} : { receiveShadow }) }] });
    const installed = await installDeclaredProps(baked.props, { scene: new Group(), scope, assets: baked.assets, materials: new Map([['pbr', material]]) });
    const flags: boolean[] = [];
    for (const root of installed.tiles.values()) root.traverse(node => { if (node instanceof Mesh) flags.push(node.receiveShadow); });
    expect(flags).toEqual([receiveShadow ?? true]);
  } finally { scope.dispose(); geometry.dispose(); material.dispose(); }
});
