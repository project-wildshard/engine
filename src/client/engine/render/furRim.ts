/**
 * The fur's backlit Fresnel rim (Pine Hollow's hull coats, `AnimalFactory`'s fur material): the coat's tips light up
 * looking toward the sun, a close-up detail that fades to a third by 40 m. One GLSL source for both owners, the hull
 * book's fur material and a PBR skin's `rim` (ONE-FORMAT OF27b), so a hull drawn as a skin wears the same rim.
 */
import type * as THREE from 'three';
import { attachFogUniforms, fogUniforms } from '../world/Atmosphere';

/** the fragment declarations the rim reads */
export const FUR_RIM_PARS = 'uniform vec3 furRimColor; uniform vec3 furSunDir;';
/** added to `outgoingLight` before `#include <opaque_fragment>` */
export const FUR_RIM_FRAGMENT = `
          {
            vec3 V = normalize( vViewPosition );
            float ndv = saturate( dot( normal, V ) );
            vec3 sunV = normalize( ( viewMatrix * vec4( furSunDir, 0.0 ) ).xyz );
            float back = saturate( dot( sunV, -V ) );                // looking toward the sun: the coat's tips light up
            float fres = pow( 1.0 - ndv, 3.2 );
            // the backlit glow is a close-up detail: past ~10 m it washes the whole silhouette into the haze and a
            // a pale creature at 25 m becomes a pale ghost you cannot aim at, so it fades to a third by 40 m
            float rimDist = 1.0 - 0.67 * smoothstep( 10.0, 40.0, length( vViewPosition ) );
            float rimAmt = fres * ( 0.02 + 1.2 * back * back ) * rimDist;
            outgoingLight += furRimColor * rimAmt * ( 0.15 + 0.85 * diffuseColor.rgb * 2.2 );
          }
          #include <opaque_fragment>`;

/** Bind the rim's colour and the shared sun direction (with the fog uniforms the rim's program carries). */
export function bindFurRim(shader: { uniforms: Record<string, THREE.IUniform>; fragmentShader: string }, rim: THREE.Color): void {
  attachFogUniforms(shader);
  shader.uniforms['furRimColor'] = { value: rim };
  shader.uniforms['furSunDir'] = fogUniforms.fogSunDir;
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <clipping_planes_pars_fragment>', `#include <clipping_planes_pars_fragment>
          ${FUR_RIM_PARS}`)
    .replace('#include <opaque_fragment>', FUR_RIM_FRAGMENT);
}
