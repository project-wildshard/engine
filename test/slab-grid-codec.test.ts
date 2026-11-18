// ONE-FORMAT OF-EM28b3: a slab chunk on its grid (Int16 words, the part's own scale and translation) decodes through the
// RM8.1e tile grid codec, so a graph's positionLocal and objectOrigin read the authored metres.
import { expect, test } from 'vitest';
import { BufferAttribute, BufferGeometry, InstancedMesh, MeshBasicMaterial, ShaderMaterial, Vector3 } from 'three';
import { ClassicCodec, codecGridded } from '../src/client/engine/render/graph/glslCodec';
import { gridSlabPositions, placeSlabPart } from '../src/client/game/shardfile/slabGrid';

function street(): BufferGeometry {
  const positions: number[] = [];
  for (let i = 0; i < 380; i++) for (let j = 0; j < 12; j++) { const x = -95 + i * 0.5, y = 120.3 + j * 0.75, z = 41.7 + (i % 7) * 0.013; positions.push(x, y, z, x + 0.5, y, z, x + 0.5, y + 0.75, z); }
  const geometry = new BufferGeometry(); geometry.setAttribute('position', new BufferAttribute(Float32Array.from(positions), 3));
  return geometry;
}

test('a graph reads the authored metres through the codec: positionLocal within 1 cm, object origin the anchor\'s', () => {
  const source = street(), metres = Float32Array.from(source.getAttribute('position').array), part = new InstancedMesh(source, new MeshBasicMaterial(), 1);
  gridSlabPositions(source); placeSlabPart(part, source);
  expect(codecGridded(part)).toBe(true);
  const material = new ShaderMaterial({ uniforms: { wsCodecStep: { value: 1 }, wsCodecOrigin: { value: new Vector3() } } });
  expect(new ClassicCodec().draw(material, part)).toBe(true);
  const step = material.uniforms['wsCodecStep']?.value as number, origin = material.uniforms['wsCodecOrigin']?.value as Vector3;
  const position = source.getAttribute('position');
  for (let v = 0; v < position.count; v += 97) {
    // glsl.ts positionLocal: wsPositionLocal * wsCodecStep + wsCodecOrigin
    const local = new Vector3(position.getX(v), position.getY(v), position.getZ(v)).multiplyScalar(step).add(origin);
    expect(local.distanceTo(new Vector3().fromArray(metres, v * 3))).toBeLessThan(0.01);
  }
  // glsl.ts objectOrigin: the model matrix at (0 - origin / step), the anchor's own origin
  expect(new Vector3().sub(origin.clone().divideScalar(step)).applyMatrix4(part.matrix).length()).toBeLessThan(1e-9);
});
