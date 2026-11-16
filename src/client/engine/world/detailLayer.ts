/**
 * One shard detail layer on screen (meta SHARD-SOURCE AP32b): the layer's card mesh as one InstancedMesh over its
 * `DetailRing`'s tables, so the whole layer is one draw call, and an optional sway on the shared wind field.
 *
 *   const layer = new DetailLayer(source, files, material, { phone });
 *   scene.add(layer.mesh);
 *   game.onUpdate(() => layer.update(camera.position));
 *
 * The material is the layer's look material; it is cloned with its shader patches, so the ring's fade and sway patch never
 * reach the shard's other draws. With a `trample` field (meta SHARD-SOURCE SS7: the engine's `systems/looks/trample.ts`, its
 * live movers and recovering trample map) each card lies over away from a mover, after the sway, and springs back as the
 * map recovers.
 */
import * as THREE from 'three';
import { DetailRing, RING_CELL, detailField, ringShape, type DetailLayerFiles, type DetailLayerSource } from './detailRing';
import { patchWindField } from './wind';
import { windUniforms } from './TreeFactory';
import { PATCH_ORDER, copyShaderPatches, patchShader } from '../render/shaderPatches';

/** A trample field a layer bends on: its uniforms (shared, so the field's updates reach the layer) and GLSL that defines
 * `vec2 trampleBend(vec2 xz)` over them (Grass.ts's `GrassTrampleField`, without the field's own methods). */
export interface DetailTrample { readonly uniforms: Readonly<Record<string, THREE.IUniform>>; readonly glsl: string }

/** SS7: the card lies over by the bend's angle (at most 1.35 rad) the way it points, its top dropping as it goes (Grass.ts's
 * TRAMPLE_APPLY), in the patch's block where `im` and `ipos` are in scope. */
const TRAMPLE_BEND = /* glsl */`
          {
            vec2 tb = trampleBend( ipos.xz );
            float tl = length( tb );
            if ( tl > 1e-3 ) {
              float ts2 = max( dot( im[0], im[0] ), 1e-6 );
              float ta = min( tl, 1.35 );
              vec2 td = tb / tl;
              vec3 tw = vec3( td.x * sin( ta ), cos( ta ) - 1.0, td.y * sin( ta ) ) * transformed.y * sqrt( ts2 );
              transformed += ( tw * im ) / ts2;
            }
          }`;

/** Cells a frame may reseed once the ring is full (Grass.ts's budget). */
const CELL_BUDGET = 6;

/** A copy of `length` bytes from `offset`, so a view over it is aligned whatever the file's layout. */
function copy(bytes: Uint8Array, offset: number, length: number): ArrayBuffer {
  return bytes.slice(offset, offset + length).buffer;
}

/** The layer's card as a BufferGeometry: the format's mesh file (f32 positions, normals, uvs, then u16 indices; no header). */
export function detailGeometry(mesh: DetailLayerSource['mesh'], bytes: Uint8Array): THREE.BufferGeometry {
  const xyz = mesh.vertices * 12, uv = mesh.vertices * 8;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(copy(bytes, 0, xyz)), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(copy(bytes, xyz, xyz)), 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(copy(bytes, xyz * 2, uv)), 2));
  geometry.setIndex(new THREE.BufferAttribute(new Uint16Array(copy(bytes, xyz * 2 + uv, mesh.triangles * 6)), 1));
  geometry.computeBoundingSphere();
  return geometry;
}

/** The fade at the ring's edge: clumps shrink to nothing over this many metres inside the ring's radius (Grass.ts's
 * trick), so the square ring's cells never pop in or out at full size as the camera crosses a cell. */
export function ringFade(radius: number): number { return Math.min(RING_CELL * 1.5, radius * 0.3); }

/** The layer's own vertex patch: the edge fade always, and with `sway` the card's top (uv.y) leans downwind by `amount`,
 * pulsing at `rate` cycles a second on the shared wind field. The wind field's GLSL goes in only when no earlier patch on
 * the look material put it there, so a wind-patched look still compiles. */
function ringMaterial(material: THREE.Material, radius: number, sway: DetailLayerSource['sway'], trample: DetailTrample | undefined): void {
  patchShader(material, 'engine.detail-ring', PATCH_ORDER.decorate, (shader) => {
    shader.uniforms['uDetailRadius'] = { value: radius };
    shader.uniforms['uDetailFade'] = { value: ringFade(radius) };
    let declare = 'uniform float uDetailRadius; uniform float uDetailFade;', bend = '';
    if (sway !== undefined) {
      if (!shader.vertexShader.includes('uniform float uWindTime')) patchWindField(shader);
      if (!shader.vertexShader.includes('uniform float uWindStrength')) declare += ' uniform float uWindStrength;';
      declare += ' uniform float uDetailSway; uniform float uDetailRate;';
      shader.uniforms['uWindStrength'] = windUniforms.uWindStrength;
      shader.uniforms['uDetailSway'] = { value: sway.amount };
      shader.uniforms['uDetailRate'] = { value: sway.rate };
      bend = /* glsl */`
          float s2 = max( dot( im[0], im[0] ), 1e-6 );
          vec2 dir = windDirXZ();
          float pulse = sin( uWindTime * uDetailRate * 6.2832 - dot( ipos.xz, dir ) * 0.3 ) * 0.5 + 0.5;
          float push = uDetailSway * uWindStrength * ( 0.3 + 0.7 * pulse ) * ( 0.6 + 0.4 * min( windGustAt( ipos.xz ), 1.3 ) );
          float h = uv.y * uv.y;
          vec3 off = vec3( dir.x, 0.0, dir.y ) * push * h;
          off.y = - length( off.xz ) * 0.3;
          transformed += ( off * im ) / s2 * sqrt( s2 );`;
    }
    if (trample !== undefined) {
      declare += trample.glsl;
      Object.assign(shader.uniforms, trample.uniforms);
      bend += TRAMPLE_BEND;
    }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n        ${declare}`)
      .replace('#include <begin_vertex>', /* glsl */`#include <begin_vertex>
        {
          mat3 im = mat3( instanceMatrix );
          vec3 ipos = ( modelMatrix * vec4( instanceMatrix[3].xyz, 1.0 ) ).xyz;${bend}
          float ringDist = distance( ipos.xz, cameraPosition.xz );
          transformed *= 1.0 - smoothstep( uDetailRadius - uDetailFade, uDetailRadius, ringDist );
        }`);
  }, { key: `detail-ring${sway === undefined ? '' : '-sway'}${trample === undefined ? '' : '-trample'}` });
}

/** One detail layer: an InstancedMesh fed by a camera ring. */
export class DetailLayer {
  readonly ring: DetailRing;
  readonly mesh: THREE.InstancedMesh;
  private readonly matrixAttribute: THREE.InstancedBufferAttribute;
  private readonly colourAttribute: THREE.InstancedBufferAttribute;
  private filled = false;

  constructor(source: DetailLayerSource, files: DetailLayerFiles, material: THREE.Material, options: { phone: boolean; trample?: DetailTrample }) {
    const field = detailField(source, files);
    this.ring = new DetailRing(field, ringShape(field, source.radius, options.phone));
    const look = material.clone();
    copyShaderPatches(material, look);
    ringMaterial(look, this.ring.shape.radius, source.sway, options.trample);
    const count = this.ring.matrices.length / 16;
    this.mesh = new THREE.InstancedMesh(detailGeometry(source.mesh, files.mesh), look, count);
    this.matrixAttribute = new THREE.InstancedBufferAttribute(this.ring.matrices, 16);
    this.matrixAttribute.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceMatrix = this.matrixAttribute;
    this.colourAttribute = new THREE.InstancedBufferAttribute(this.ring.colours, 3);
    this.colourAttribute.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = this.colourAttribute;
    this.mesh.name = `detail:${source.id}`;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = source.shadow;
    this.mesh.receiveShadow = true;
  }

  /** Follow the camera: the first call fills the whole ring, later ones reseed a few cells a frame. */
  update(eye: { x: number; z: number }): void {
    this.ring.update(eye.x, eye.z, this.filled ? CELL_BUDGET : Infinity);
    this.filled = true;
    const ranges = this.ring.take();
    if (ranges.length === 0) return;
    for (const [slot, slots] of ranges) {
      this.matrixAttribute.addUpdateRange(slot * 16, slots * 16);
      this.colourAttribute.addUpdateRange(slot * 3, slots * 3);
    }
    this.matrixAttribute.needsUpdate = true;
    this.colourAttribute.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    const look = this.mesh.material;
    if (!Array.isArray(look)) look.dispose();
    this.mesh.dispose();
  }
}
