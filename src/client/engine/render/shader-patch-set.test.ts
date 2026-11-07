import { expect, test } from 'vitest';
import * as THREE from 'three';
import { patchShader, shaderPatchProgramKey, shaderPatchSet, shaderPatchSceneShape, copyShaderPatches } from './shaderPatches';

// a kept node key is reused while its patch set is the same object: a patch added gives a new set, and a key function not
// marked pure never gives a reusable one
test('the patch set changes with each patch and is never reusable for an impure key', () => {
  const pure = new THREE.MeshBasicMaterial(), impure = new THREE.MeshBasicMaterial();
  try {
    expect(shaderPatchSet(pure)).toBeNull();
    patchShader(pure, 'a', 10, () => undefined, { key: 'a' });
    shaderPatchProgramKey(pure, 'base');
    const first = shaderPatchSet(pure);
    expect(first).not.toBeNull(); expect(shaderPatchSet(pure)).toBe(first);
    patchShader(pure, 'b', 20, () => undefined, { key: 'b' });
    shaderPatchProgramKey(pure, 'base');
    expect(shaderPatchSet(pure)).not.toBe(first);
    patchShader(impure, 'c', 10, () => undefined, { key: (before: string) => `${before}|c` });
    shaderPatchProgramKey(impure, 'base');
    expect(shaderPatchSet(impure)).not.toBe(shaderPatchSet(impure));
  } finally { pure.dispose(); impure.dispose(); }
});


test('scene shape sharing requires explicit pure patch certificates', () => {
  const material = new THREE.MeshBasicMaterial(), copy = new THREE.MeshBasicMaterial();
  try {
    const certified = patchShader(material, 'known', 10, () => undefined,
      { key: key => `${key}|known`, pureKey: true, sceneShapeKey: true });
    expect(shaderPatchSceneShape(material)).toBe(true);
    copyShaderPatches(material, copy);
    expect(shaderPatchSceneShape(copy)).toBe(true);
    const custom = patchShader(material, 'custom', 20, () => undefined,
      { key: key => `${key}|custom`, pureKey: true });
    expect(shaderPatchSceneShape(material)).toBe(false);
    custom();
    expect(shaderPatchSceneShape(material)).toBe(true);
    certified();
    expect(shaderPatchSceneShape(material)).toBe(true);
    const impure = patchShader(material, 'impure', 10, () => undefined,
      { key: key => `${key}|changing`, sceneShapeKey: true });
    expect(shaderPatchSceneShape(material)).toBe(false);
    impure();
  } finally { material.dispose(); copy.dispose(); }
});
