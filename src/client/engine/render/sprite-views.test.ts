import { expect, test, vi } from 'vitest';
import { BoxGeometry, Color, Group, Mesh, MeshBasicMaterial, type WebGLRenderer } from 'three';
import { bakeSpriteViews } from './spriteViews';

test('a hidden warm shot submits its rig without a precise vertex walk', () => {
  const parent = new Group(), rig = new Mesh(new BoxGeometry(2, 4, 1), new MeshBasicMaterial());
  parent.add(rig); rig.position.set(9, 1, -7);
  const vertices = vi.spyOn(rig, 'getVertexPosition');
  const draw = vi.fn();
  const renderer = {
    autoClear: true, getClearColor: () => new Color(1, 1, 1), getClearAlpha: () => 1,
    getRenderTarget: () => null, getScissorTest: () => false, clear: vi.fn(),
    setRenderTarget: vi.fn(), setClearColor: vi.fn(), setScissorTest: vi.fn(),
    render: () => { draw(rig.frustumCulled); },
  } as unknown as WebGLRenderer;
  const warm = bakeSpriteViews(renderer, rig, { views: 1, size: 4, warmFrame: { y: 1, half: 3 } });
  expect(vertices).not.toHaveBeenCalled();
  expect(draw.mock.calls).toEqual([[false]]);
  expect(rig.frustumCulled).toBe(true);
  expect(rig.parent).toBe(parent);
  expect(rig.position.toArray()).toEqual([9, 1, -7]);
  const visible = bakeSpriteViews(renderer, rig, { views: 2, size: 16 });
  expect(vertices).toHaveBeenCalled();
  expect(draw.mock.calls).toEqual([[false], [true], [true]]);
  expect(visible.width).toBeCloseTo(4.2);
  warm.texture.dispose(); visible.texture.dispose();
});
