/**
 * The PBR family's measure layer (SHARD-PLATFORM SF56, G152): a blockout "dev map" look in the spirit of the Source
 * engine's developer measure textures, drawn entirely by the shader (no texture, no memory). A PBR surface that declares
 * the layer always draws it (G163: Jake picked the dev map over the plain grey; G669 DR14 retired G527's clay variant).
 * Per pixel:
 * - the surface takes its role's flat colour (structure orange, trim grey, floor light grey) in place of its vertex colour,
 *   a share of it glowing so a shade side stays readable (the dev textures' flat read);
 * - a 1 m grid and a lighter sub-grid cross it, each line at least a pixel wide and faded by coverage (crisp at 2×, no
 *   moiré far off);
 * - a structure or trim face of at least 1 m × 1 m carries its size in metres ("4×3") as seven-segment glyphs in its
 *   top-left corner.
 * Role, face metres and size ride in the first UV set (`measureUv` in params.ts); a surface with none is floor, gridded in
 * world space. The layer is self-contained (this module, `MeasureLayerSchema` and `measureUv`), so a later material
 * format can carry it as one node. Identifiers carry a `famM` prefix.
 */
import * as THREE from 'three';
import { patchShader, PATCH_ORDER } from '../shaderPatches';
import { MEASURE_SLOT, type MeasureLayerParams } from '@wildshard/format/materialFamilies';

/** the program-cache key of every PBR material with a measure layer */
export const MEASURE_PROGRAM_KEY = 'family.pbr.measure.v1';

const VERT_PARS = 'varying vec2 vFamMUv;\nvarying vec3 vFamMPos;\nvarying vec3 vFamMN;';
const VERT_WORLD = /* glsl */`#include <worldpos_vertex>
vec4 famMW = vec4( transformed, 1.0 );
vec3 famMN = objectNormal;
#ifdef USE_INSTANCING
famMW = instanceMatrix * famMW;
famMN = mat3( instanceMatrix ) * famMN;
#endif
vFamMPos = ( modelMatrix * famMW ).xyz;
vFamMN = normalize( mat3( modelMatrix ) * famMN );
vFamMUv = uv;`;

const FRAG_PARS = /* glsl */`
varying vec2 vFamMUv;
varying vec3 vFamMPos;
varying vec3 vFamMN;
uniform vec3 famMStructure;
uniform vec3 famMTrim;
uniform vec3 famMFloor;
uniform vec4 famMLine;      // colour, half-width (m)
uniform vec3 famMAlpha;     // line on a role surface, line on the floor, sub-grid
uniform float famMSub;      // sub-grid step (m)
uniform vec4 famMLabel;     // colour, glyph height (m)
uniform float famMLift;     // the share of the role colour that glows (a flat, readable shade side)

// coverage of lines every pitch (c in metres), at least a pixel wide, dimmed by how thin they are and faded once a pitch
// shrinks toward a few pixels
float famMGrid( vec2 c, float pitch, float hw ) {
  vec2 fw = max( fwidth( c ), vec2( 1e-5 ) );
  vec2 d = abs( fract( c / pitch + 0.5 ) - 0.5 ) * pitch;
  vec2 w = max( vec2( hw ), fw * 0.75 );
  vec2 l = ( 1.0 - smoothstep( w - fw * 0.5, w + fw * 0.5, d ) ) * min( vec2( 1.0 ), vec2( hw ) / w * 1.6 );
  l *= 1.0 - smoothstep( pitch * 0.12, pitch * 0.35, fw );
  return max( l.x, l.y );
}
float famMBox( vec2 p, vec2 c, vec2 h ) { vec2 q = abs( p - c ) - h; return length( max( q, 0.0 ) ) + min( max( q.x, q.y ), 0.0 ); }
float famMSeg( vec2 a, vec2 b, vec2 p ) { vec2 pa = p - a, ba = b - a; return length( pa - ba * clamp( dot( pa, ba ) / dot( ba, ba ), 0.0, 1.0 ) ); }
// signed distance (glyph heights) to a glyph in a 0.55 × 1 box: 0–9 seven-segment digits, 10 = '.', 11 = '×'
float famMGlyph( vec2 p, int ch ) {
  const float t = 0.055;
  if ( ch == 10 ) return famMBox( p, vec2( 0.12, 0.07 ), vec2( 0.07 ) );
  if ( ch == 11 ) return min( famMSeg( vec2( 0.06, 0.2 ), vec2( 0.46, 0.7 ), p ), famMSeg( vec2( 0.06, 0.7 ), vec2( 0.46, 0.2 ), p ) ) - t;
  int m = ch == 0 ? 63 : ch == 1 ? 6 : ch == 2 ? 91 : ch == 3 ? 79 : ch == 4 ? 102 : ch == 5 ? 109 : ch == 6 ? 125 : ch == 7 ? 7 : ch == 8 ? 127 : 111;
  float d = 1e3;
  vec2 hz = vec2( 0.17, t ), vt = vec2( t, 0.2 );
  if ( ( m & 1 ) != 0 ) d = min( d, famMBox( p, vec2( 0.275, 0.94 ), hz ) );
  if ( ( m & 2 ) != 0 ) d = min( d, famMBox( p, vec2( 0.49, 0.72 ), vt ) );
  if ( ( m & 4 ) != 0 ) d = min( d, famMBox( p, vec2( 0.49, 0.28 ), vt ) );
  if ( ( m & 8 ) != 0 ) d = min( d, famMBox( p, vec2( 0.275, 0.06 ), hz ) );
  if ( ( m & 16 ) != 0 ) d = min( d, famMBox( p, vec2( 0.06, 0.28 ), vt ) );
  if ( ( m & 32 ) != 0 ) d = min( d, famMBox( p, vec2( 0.06, 0.72 ), vt ) );
  if ( ( m & 64 ) != 0 ) d = min( d, famMBox( p, vec2( 0.275, 0.5 ), hz ) );
  return d;
}
// the label's characters for a w × h size in half metres: "w×h", a half as ".5", up to 9 characters
int famMChars( int wq, int hq, out int s[ 9 ] ) {
  int n = 0;
  for ( int k = 0; k < 9; k++ ) s[ k ] = 0;
  for ( int part = 0; part < 2; part++ ) {
    int q = part == 0 ? wq : hq, whole = q / 2;
    if ( part == 1 ) { s[ n ] = 11; n++; }
    if ( whole >= 10 ) { s[ n ] = whole / 10; n++; }
    s[ n ] = whole - ( whole / 10 ) * 10; n++;
    if ( q - whole * 2 == 1 ) { s[ n ] = 10; n++; s[ n ] = 5; n++; }
  }
  return n;
}
`;

const FRAG_MAIN = /* glsl */`#include <color_fragment>
vec3 famMGlow = vec3( 0.0 );
{
  float famMCode = floor( vFamMUv.x / ${MEASURE_SLOT.toFixed(1)} );
  int famMRole = int( famMCode ) - ( int( famMCode ) / 4 ) * 4;
  vec3 famMNa = abs( vFamMN );
  // floor: world metres on the plane the surface faces; a role face: its own metres from its bottom-left corner
  vec2 famMWorld = famMNa.y >= max( famMNa.x, famMNa.z ) ? vFamMPos.xz : ( famMNa.x >= famMNa.z ? vFamMPos.zy : vFamMPos.xy );
  vec2 famMFace = vec2( vFamMUv.x - famMCode * ${MEASURE_SLOT.toFixed(1)}, vFamMUv.y - floor( vFamMUv.y / ${MEASURE_SLOT.toFixed(1)} ) * ${MEASURE_SLOT.toFixed(1)} ) - 1.0;
  bool famMHasRole = famMRole == 1 || famMRole == 2;
  vec2 famMC = famMHasRole ? famMFace : famMWorld;
  float famMMain = famMGrid( famMC, 1.0, famMLine.w );
  float famMFine = famMGrid( famMC, famMSub, famMLine.w * 0.6 );
  // the size label in the face's top-left corner, in glyph heights
  int famMWq = int( famMCode ) / 4, famMHq = int( floor( vFamMUv.y / ${MEASURE_SLOT.toFixed(1)} ) );
  float famMW = float( famMWq ) * 0.5, famMH = float( famMHq ) * 0.5;
  float famMGh = min( famMLabel.w, 0.2 * min( famMW, famMH ) ), famMMargin = 0.4 * famMGh;
  vec2 famML = vec2( famMFace.x - famMMargin, famMFace.y - ( famMH - famMMargin - famMGh ) ) / max( famMGh, 1e-3 );
  float famMAa = max( length( fwidth( famML ) ) * 0.6, 1e-4 );
  float famMInk = 0.0;
  if ( famMHasRole && famMWq >= 2 && famMHq >= 2 && famML.y > -0.2 && famML.y < 1.2 && famML.x > -0.2 ) {
    int famMS[ 9 ];
    int famMN = famMChars( famMWq, famMHq, famMS );
    int famMI = int( floor( famML.x / 0.7 ) );
    if ( famMI >= 0 && famMI < famMN ) {
      int famMCh = 0;
      for ( int k = 0; k < 9; k++ ) if ( k == famMI ) famMCh = famMS[ k ];
      famMInk = 1.0 - smoothstep( -famMAa, famMAa, famMGlyph( vec2( famML.x - float( famMI ) * 0.7, famML.y ), famMCh ) );
    }
  }
  vec3 famMBase = famMRole == 1 ? famMStructure : famMRole == 2 ? famMTrim : famMFloor;
  float famMLineA = famMHasRole ? famMAlpha.x : famMAlpha.y;
  vec3 famMOut = mix( famMBase, famMLine.rgb, famMFine * famMAlpha.z );
  famMOut = mix( famMOut, famMLine.rgb, famMMain * famMLineA );
  famMOut = mix( famMOut, famMLabel.rgb, famMInk * 0.92 );
  diffuseColor.rgb = famMOut;
  famMGlow = famMOut * famMLift;
}`;
const FRAG_GLOW = '#include <emissivemap_fragment>\ntotalEmissiveRadiance += famMGlow;';


const linear = (rgb: readonly [number, number, number]): THREE.Color => new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);

/** Add a measure layer to a PBR family material (the PBR compiler calls it; the program becomes the measure program). */
export function applyMeasure(m: THREE.MeshStandardMaterial, p: MeasureLayerParams): void {
  const line = linear(p.line.colour), label = linear(p.label.colour);
  const uniforms: Record<string, { value: unknown }> = {
    famMStructure: { value: linear(p.structure) },
    famMTrim: { value: linear(p.trim) },
    famMFloor: { value: linear(p.floor) },
    famMLine: { value: new THREE.Vector4(line.r, line.g, line.b, p.line.width) },
    famMAlpha: { value: new THREE.Vector3(p.line.alpha, p.line.floorAlpha, p.sub.alpha) },
    famMSub: { value: p.sub.step },
    famMLabel: { value: new THREE.Vector4(label.r, label.g, label.b, p.label.height) },
    famMLift: { value: p.lift },
  };
  patchShader(m, 'engine.family.measure', PATCH_ORDER.material, (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${VERT_PARS}`).replace('#include <worldpos_vertex>', VERT_WORLD);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${FRAG_PARS}`).replace('#include <color_fragment>', FRAG_MAIN).replace('#include <emissivemap_fragment>', FRAG_GLOW);
  }, { key: MEASURE_PROGRAM_KEY });
}
