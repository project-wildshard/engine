import { expect, test } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshLambertMaterial, MeshStandardMaterial } from 'three';
import { Scope } from '@wildshard/engine/app/scope';
import { cellClip } from './cellClip';

test('a clipped variant keeps its source\'s defines (the cascades\' USE_CSM), so it shadows and keys like its source', () => {
  const scope = new Scope('clip defines'), root = new Group();
  try {
    const lambert = new MeshLambertMaterial(), standard = new MeshStandardMaterial();
    for (const material of [lambert, standard]) material.defines = { ...material.defines, USE_CSM: 1, CSM_CASCADES: 3, CSM_FADE: '' };
    const guard = cellClip(root, 250, scope); guard.sweep();
    const plain = new Mesh(new BoxGeometry(2, 40, 2), lambert); plain.position.x = 250; root.add(plain);
    const physical = new Mesh(new BoxGeometry(2, 40, 2), standard); physical.position.x = -250; root.add(physical);
    expect(plain.material).not.toBe(lambert); expect(physical.material).not.toBe(standard);
    expect(plain.material.defines).toEqual({ USE_CSM: 1, CSM_CASCADES: 3, CSM_FADE: '' });
    expect(physical.material.defines).toEqual({ STANDARD: '', USE_CSM: 1, CSM_CASCADES: 3, CSM_FADE: '' });
    expect(plain.material.defines).not.toBe(lambert.defines);
  } finally { scope.dispose(); }
});

test('a clipped material keeps its alpha cutoff (D189: a cut-out card clipped as an opaque quad)', () => {
  const scope = new Scope('clip alpha'), root = new Group();
  try {
    const cards = new MeshStandardMaterial(); cards.alphaTest = 0.45;
    const guard = cellClip(root, 250, scope); guard.sweep();
    const crossing = new Mesh(new BoxGeometry(2, 40, 2), cards); crossing.position.x = 250; root.add(crossing);
    expect(crossing.material).not.toBe(cards);
    expect(crossing.material.alphaTest).toBe(0.45);
  } finally { scope.dispose(); }
});

test('T10: matrix writes are hooked only on manual nodes (an auto node recomposes its matrix), and still clip there', () => {
  const scope = new Scope('clip matrix writes'), root = new Group();
  try {
    const material = new MeshLambertMaterial(), guard = cellClip(root, 250, scope); guard.sweep();
    const auto = new Mesh(new BoxGeometry(2, 40, 2), material); root.add(auto);
    expect(Object.getOwnPropertyDescriptor(auto.matrix, 'copy')).toBeUndefined();
    const manual = new Mesh(new BoxGeometry(2, 40, 2), material); manual.matrixAutoUpdate = false; root.add(manual); guard.sweep();
    expect(manual.material).toBe(material);
    expect(Object.getOwnPropertyDescriptor(manual.matrix, 'copy')).toBeDefined();
    manual.matrix.setPosition(250, 0, 0); manual.updateMatrixWorld(true); guard.sweep();
    expect(manual.material).not.toBe(material);
    manual.matrixAutoUpdate = true;
    expect(Object.getOwnPropertyDescriptor(manual.matrix, 'copy')).toBeUndefined();
    manual.matrixAutoUpdate = false;
    expect(Object.getOwnPropertyDescriptor(manual.matrix, 'copy')).toBeDefined();
  } finally { scope.dispose(); }
});

test('PF1: a clipped stage keeps its leading #extension lines first (a graph batch opens with GL_ANGLE_multi_draw)', () => {
  const scope = new Scope('clip directives'), root = new Group();
  try {
    const material = new MeshLambertMaterial(), guard = cellClip(root, 250, scope); guard.sweep();
    const crossing = new Mesh(new BoxGeometry(2, 40, 2), material); crossing.position.x = 250; root.add(crossing);
    const clipped = crossing.material;
    expect(clipped).not.toBe(material);
    const compile = (vertexShader: string): { vertexShader: string; fragmentShader: string } => {
      const shader = { vertexShader, fragmentShader: 'void main() { }', uniforms: {} };
      const run: unknown = Reflect.get(clipped, 'onBeforeCompile');
      if (typeof run !== 'function') throw new Error('Missing clip patch');
      Reflect.apply(run, clipped, [shader, null]);
      return shader;
    };
    const batched = compile('#extension GL_ANGLE_multi_draw : require\n\n#define USE_BATCHING\nvoid main() { gl_Position = vec4(0.0); }');
    expect(batched.vertexShader.startsWith('#extension GL_ANGLE_multi_draw : require\n\n\n#if __VERSION__ >= 300')).toBe(true);
    expect(batched.vertexShader.indexOf('#extension', 1)).toBe(-1);
    // a stage without directives is the old text, byte for byte
    const plain = compile('void main() { gl_Position = vec4(0.0); }');
    expect(plain.vertexShader.startsWith('\n#if __VERSION__ >= 300\nout highp vec3 wsCellWorld;')).toBe(true);
    expect(plain.fragmentShader.startsWith('\n#if __VERSION__ >= 300\nin highp vec3 wsCellWorld;')).toBe(true);
  } finally { scope.dispose(); }
});
