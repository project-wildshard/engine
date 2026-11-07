import * as THREE from 'three';

/**
 * three r186's CSMShader replaces `lights_fragment_begin` with a copy that predates the
 * `#ifdef STANDARD` block computing `material.dfg` / multi-scattering compensation, so every
 * CSM material loses its IBL specular (metals go black, water loses its sky). Re-insert it (the sky rig, once, before a
 * material compiles).
 */
export function patchCSMShaderChunk(): void {
  const chunk = THREE.ShaderChunk.lights_fragment_begin;
  if (chunk.includes('material.dfg')) return;
  const block = /* glsl */`
#ifdef STANDARD
	float dotNVms = saturate( dot( geometryNormal, geometryViewDir ) );
	material.dfg = texture2D( dfgLUT, vec2( material.roughness, dotNVms ) ).rg;
	#if ( NUM_SUN_LIGHTS > 0 || NUM_DIR_LIGHTS > 0 || NUM_POINT_LIGHTS > 0 || NUM_SPOT_LIGHTS > 0 )
		float EssMs = material.dfg.x + material.dfg.y;
		material.multiScatteringCompensation = 1.0 + material.specularColorBlended * ( 1.0 / EssMs - 1.0 );
	#endif
#endif
IncidentLight directLight;`;
  THREE.ShaderChunk.lights_fragment_begin = chunk.replace('IncidentLight directLight;', block);
}
