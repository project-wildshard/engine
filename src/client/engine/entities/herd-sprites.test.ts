import { expect, test } from 'vitest';
import { DataTexture, ShaderMaterial, Vector3 } from 'three';
import { HerdSprites, spriteView } from './herdSprites';

test('a card shows the view shot from the camera\'s bearing in the animal\'s own frame', () => {
  // an animal facing +z (yaw 0): a camera in front (+z) sees view 0, to its right (+x) view 2 of 8, behind view 4
  expect(spriteView(0, 1, 0, 8)).toBe(0);
  expect(spriteView(1, 0, 0, 8)).toBe(2);
  expect(spriteView(0, -1, 0, 8)).toBe(4);
  expect(spriteView(-1, 0, 0, 8)).toBe(6);
  // turned a quarter to +x, the camera at +x is in front of it again
  expect(spriteView(1, 0, Math.PI / 2, 8)).toBe(0);
  // the nearest view wins, never out of range
  expect(spriteView(Math.sin(0.3), Math.cos(0.3), 0, 8)).toBe(0);
  expect(spriteView(Math.sin(0.5), Math.cos(0.5), 0, 8)).toBe(1);
  for (let a = -10; a <= 10; a += 0.37) { const v = spriteView(Math.sin(a), Math.cos(a), 1.1, 8); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(8); }
});

test('thirty far deer are one instanced card with their yaws, its foot on the ground', () => {
  const sprites = new HerdSprites({ texture: new DataTexture(new Uint8Array(4), 1, 1), views: 8, width: 2, height: 2, offsetY: 0 }, 32);
  for (let i = 0; i < 30; i++) sprites.place(i, new Vector3(i * 2.6, 0, -200), i * 0.1, 1);
  sprites.update();
  expect(sprites.mesh.count).toBe(30);
  expect(sprites.mesh.geometry.getAttribute('spriteYaw').getX(29)).toBeCloseTo(2.9);
  sprites.mesh.geometry.computeBoundingBox();
  expect(sprites.mesh.geometry.boundingBox?.min.y).toBeCloseTo(0);
  expect(sprites.mesh.material).toBeInstanceOf(ShaderMaterial);
  expect(sprites.mesh.boundingSphere?.radius ?? 0).toBeGreaterThan(30);
  sprites.dispose();
});
