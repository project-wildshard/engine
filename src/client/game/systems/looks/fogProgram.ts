export const fogGLSL = /* glsl */`
  uniform vec3 fogColor; uniform vec3 fogSunDir; uniform vec3 fogSunColor;
  uniform float fogHeight; uniform float fogHeightFalloff; uniform float fogHeightDensity; uniform float fogDistDensity;
  float atmosFogFactor( vec3 wp ) {
    vec3 ray = wp - cameraPosition; float rayLen = length( ray );
    float dy = wp.y - cameraPosition.y;
    float camF = exp( - fogHeightFalloff * ( cameraPosition.y - fogHeight ) );
    float t = fogHeightFalloff * dy;
    float integ = abs( t ) > 1e-3 ? ( 1.0 - exp( - t ) ) / t : 1.0;
    float heightAmt = fogHeightDensity * camF * integ * rayLen;
    float distAmt = fogDistDensity * rayLen;
    return clamp( 1.0 - exp( - ( heightAmt + distAmt ) ), 0.0, 1.0 );
  }
  vec3 atmosFogColor( vec3 wp ) {
    vec3 viewDir = normalize( wp - cameraPosition );
    float sunAmt = max( dot( viewDir, fogSunDir ), 0.0 );
    return mix( fogColor, fogSunColor, pow( sunAmt, 6.0 ) * 0.7 );
  }`;
