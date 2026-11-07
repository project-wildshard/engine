import type { Scope } from '@wildshard/engine/app/scope';
import type { WorldSceneUniformSet } from '@wildshard/format/worldScenes';
import { uniformsFrom, type UniformMap } from '../plugin/shaderFamily';
import { lendUniforms } from './lentLooks';
import type { SceneHandles } from './sceneHandles';

/** Client-only: make each declared uniform set from its rows, bind its textures, vectors and numbers to the scene handles
 *  the world's lent textures published (the same objects; a number as published), and lend it by id until `owner` ends. */
export function lendWorldSceneUniforms(sets: readonly WorldSceneUniformSet[], owner: Scope, handles: SceneHandles): void {
  for (const set of sets) {
    const uniforms: UniformMap = uniformsFrom(set.rows);
    for (const [name, handle] of Object.entries(set.textures)) uniforms[name] = { value: handles.texture(handle) };
    for (const [name, handle] of Object.entries(set.vectors)) uniforms[name] = { value: handles.vector(handle) };
    for (const [name, handle] of Object.entries(set.numbers)) uniforms[name] = { value: handles.number(handle) };
    lendUniforms(owner, set.id, uniforms);
  }
}
