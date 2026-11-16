// NINE-DRAGON-BENCHMAX NB8: the board under you was 11 draws (12 with its depth clear) on the phone's walk. Every solid part
// is one mesh, each vertex carrying its part's look; the additive halos are the other, drawn in one pass: 2 meshes, every
// triangle kept, each part's colour, roughness, metalness and emissive kind as its own material had them.
import * as THREE from 'three';
import { expect, test } from 'vitest';
import { buildHoverboard } from './hoverboardGeometry';

const triangles = (g: THREE.BufferGeometry): number => (g.index?.count ?? g.getAttribute('position').count) / 3;

test('two meshes: the solid parts with their looks per vertex, the halos in one pass', () => {
  const g = new THREE.Group();
  const { pulse, glow } = buildHoverboard(g);
  const meshes = g.children.filter((o): o is THREE.Mesh => o instanceof THREE.Mesh);
  expect(meshes.map(m => m.material)).toEqual([pulse, glow]);
  expect(glow.forceSinglePass && glow.side === THREE.DoubleSide && glow.blending === THREE.AdditiveBlending && !glow.depthWrite).toBe(true);
  expect(pulse.vertexColors).toBe(true);
  // deck 524, grip 140, strip 352, lamp 12, inlay 12, discs 2 × 96; halos 2 × 24
  const [solid, halos] = meshes;
  if (solid === undefined || halos === undefined) throw new Error('no board');
  expect(meshes.map(m => triangles(m.geometry))).toEqual([1232, 48]);
  // each part's look, in draw order: [first vertex, vertex count, colour, roughness, metalness, emissive kind]
  const parts: [number, number, number, number, number, number][] = [
    [0, 524 * 3, 0x1a1d24, 0.55, 0.35, 0], [524 * 3, 140 * 3, 0x2b303a, 0.95, 0.05, 0], [664 * 3, 376 * 3, 0x0a1a22, 0.4, 0, 1], [1040 * 3, 192 * 3, 0x0d2a36, 0.3, 0.2, 2],
  ];
  const colour = solid.geometry.getAttribute('color'), look = solid.geometry.getAttribute('aBoard');
  for (const [first, count, hex, roughness, metalness, emissive] of parts) {
    const c = new THREE.Color(hex);
    for (const at of [first, first + count - 1]) {
      expect([colour.getX(at), colour.getY(at), colour.getZ(at)].map(v => Math.fround(v))).toEqual([c.r, c.g, c.b].map(v => Math.fround(v)));
      expect([look.getX(at), look.getY(at), look.getZ(at)]).toEqual([roughness, metalness, emissive].map(v => Math.fround(v)));
    }
  }
  // the discs and halos at both ends, under the deck
  const box = new THREE.Box3().setFromObject(halos);
  expect(box.min.z).toBeCloseTo(-0.9 * 0.3 - 0.15, 5); expect(box.max.z).toBeCloseTo(0.9 * 0.3 + 0.15, 5);
  expect(box.max.y).toBeCloseTo(-0.032 / 2 - 0.045, 5);
});

test('the patched program keeps the strip on the animated emissive and the discs on a fixed cyan', () => {
  const { pulse } = buildHoverboard(new THREE.Group());
  const shader = { uniforms: {} as Record<string, THREE.IUniform>, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader };
  pulse.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, undefined as unknown as THREE.WebGLRenderer);
  expect(shader.fragmentShader).toContain('float roughnessFactor = vBoard.x;');
  expect(shader.fragmentShader).toContain('float metalnessFactor = vBoard.y;');
  expect(shader.fragmentShader).toContain('uDiscEmissive');
  expect(shader.vertexShader).toContain('vBoard = aBoard;');
  const disc = shader.uniforms['uDiscEmissive']; if (disc === undefined) throw new Error('no disc emissive');
  expect((disc.value as THREE.Color).equals(new THREE.Color(0x8fe3ff).multiplyScalar(3))).toBe(true);
});
