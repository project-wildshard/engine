import { graphicsMode } from '@wildshard/engine/core/graphicsMode';
import { TIER } from '@wildshard/engine/core/tier';
import { ShaderMaterial, type BufferGeometry } from 'three';
import { jsonSlot } from '@wildshard/engine/saves/slots';
import type { InstanceTier } from '@wildshard/engine/render/streamedInstances';

const rejectSlot = jsonSlot('debug.coverVertexReject', 'device');
const phaseSlot = jsonSlot('debug.coverVertexPhase', 'device');
const behindSlot = jsonSlot('debug.coverBehind', 'device');

interface CoverVertexSettings { readonly reject: boolean; readonly phase: boolean; readonly behind: boolean }

export function coverVertexSettings(): CoverVertexSettings {
  try {
    if (TIER === 'phone' && graphicsMode() === 'low') return { reject: rejectSlot.read() === true, phase: phaseSlot.read() === true, behind: behindSlot.read() === true };
  } catch { /* blocked storage uses the defaults */ }
  return { reject: false, phase: false, behind: false };
}

/** Same float32 wrap as the graph's atan of the two packed yaw-basis coefficients. */
export function coverVertexPhase(cos: number, sin: number): number {
  const radians = Math.fround(Math.atan2(Math.fround(sin), Math.fround(cos)));
  const turns = Math.fround(Math.fround(radians / Math.fround(6.2831853)) + 1);
  return turns - Math.floor(turns);
}

export const COVER_PHASE_ATTRIBUTE = 'aCoverPhase';

// The streamed cover's visibility expression depends only on the instance and camera.
// Match the whole expression and the collapsed position before relocating the calculation.
// Any different graph lowering keeps its original shader.
const START = '  vec3 wsPositionLocal = wsInstanceTransform( vec4( transformed, 1.0 ) ).xyz;';
const ORIGIN = '  vec3 t0_io = (modelMatrix * vec4(wsInstanceTransform(vec4(0.0, 0.0, 0.0, 1.0)).xyz - wsCodecOrigin / wsCodecStep, 1.0)).xyz;';
const AXIS = `  vec4 t42_axis4 = wsInstanceTransform(vec4(1.0, 0.0, 0.0, 0.0));
  vec3 t43_axis = t42_axis4.xyz;`;
const farMode = (parameter: string): string => `  bool t49_isFar = wsP_${parameter} > 1.5;`;
const handoverMode = (parameter: string): string => `  bool t111_handover = wsP_${parameter} > 0.5;`;
const YAW = `  float t61_axisZ = t43_axis.z;
  float t62_axisNz = - t61_axisZ;
  float t63_axisX = t43_axis.x;
  float t64_yaw = atan(t62_axisNz, t63_axisX);
  float t65_turns = t64_yaw / 6.2831853;
  float t66_turns1 = t65_turns + 1.0;
  float t67_h = fract(t66_turns1);`;
const visibility = (lodReach: string): string => `  float t50_rkA = wsP_reachUp * 0.7;
  float t51_nrmY = aNrm.y;
  float t52_slope = 1.0 - t51_nrmY;
  float t53_slopeK = smoothstep(0.01, 0.08, t52_slope);
  float t54_rkB = t50_rkA * t53_slopeK;
  float t55_rk = t54_rkB + 1.0;
  vec3 t56_reach = wsP_reach * vec3(t55_rk);
  float t57_rX = t56_reach.x;
  float t58_rZ = t56_reach.z;
  float t59_rFrom = t57_rX + t58_rZ;
  float t60_rY = t56_reach.y;
${YAW}
  float t68_edge = mix(t59_rFrom, t60_rY, t67_h);
  vec3 t69_toC = wsFrameCamera - t0_io;
  float t70_dc = length(t69_toC);
  float t71_pastNear = step(t68_edge, t70_dc);
  vec3 t72_farR = wsP_${lodReach} * vec3(t55_rk);
  float t73_fX = t72_farR.x;
  float t74_fZ = t72_farR.z;
  float t75_fFrom = t73_fX + t74_fZ;
  float t76_fY = t72_farR.y;
  float t77_fEdge = mix(t75_fFrom, t76_fY, t67_h);
  float t78_insideFar = step(t70_dc, t77_fEdge);
  float t79_visFar = t71_pastNear * t78_insideFar;
  float t80_visNear = step(t70_dc, t68_edge);
  float t81_vis = mix(t80_visNear, t79_visFar, float(t49_isFar));`;
const COLLAPSE = `  vec3 t82_shown = t48_bent * vec3(t81_vis);
  vec3 t83_position = t0_io + t82_shown;`;
// Match the motion before using its analytic bound. The view test may skip only a whole plant.
const DEFORMATION = `  vec3 t1_rel = (wsPositionLocal * wsCodecStep + wsCodecOrigin) - t0_io;
  vec2 t2_ioXz = t0_io.xz;
  vec2 t3_playerXz = wsP_player.xz;
  vec2 t4_away = t2_ioXz - t3_playerXz;
  float t5_awayL = length(t4_away);
  float t6_dl = max(t5_awayL, 0.001);
  vec2 t7_awayN = t4_away / (vec2(t6_dl) + step(abs(vec2(t6_dl)), vec2(1e-6)) * 1e-6);
  float t8_nearLegs = smoothstep(0.35, 1.5, t6_dl);
  float t9_legsK = 1.0 - t8_nearLegs;
  float t10_legs = t9_legsK * 1.1;
  vec2 t11_push = t7_awayN * vec2(t10_legs);
  float t12_t17 = wsWindTime * 1.7;
  float t13_ioX = t0_io.x;
  float t14_phX = t13_ioX * 0.31;
  float t15_ioZ = t0_io.z;
  float t16_phZ = t15_ioZ * 0.23;
  float t17_ph = t14_phX + t16_phZ;
  float t18_wa = t12_t17 + t17_ph;
  float t19_swa = sin(t18_wa);
  float t20_t31 = wsWindTime * 3.1;
  float t21_ph17 = t17_ph * 1.7;
  float t22_wb = t20_t31 + t21_ph17;
  float t23_swb = sin(t22_wb);
  float t24_swbH = t23_swb * 0.5;
  float t25_windX = t19_swa + t24_swbH;
  float t26_t13 = wsWindTime * 1.3;
  float t27_wc = t26_t13 + t17_ph;
  float t28_cwc = cos(t27_wc);
  float t29_windZ = t28_cwc * 0.6;
  vec2 t30_wind2 = vec2(t25_windX, t29_windZ);
  float t31_gustK = wsWindGust * 0.18;
  float t32_windK = t31_gustK + 0.05;
  vec2 t33_wind = t30_wind2 * vec2(t32_windK);
  vec2 t34_sway = t11_push + t33_wind;
  float t35_geoY = (position * wsCodecStep + wsCodecOrigin).y;
  float t36_hgt = max(t35_geoY, 0.0);
  vec2 t37_off = t34_sway * vec2(t36_hgt);
  float t38_offX = t37_off.x;
  float t39_offL = length(t37_off);
  float t40_dropA = t39_offL * (-0.4);
  float t41_dropB = t40_dropA * t36_hgt;
${AXIS}
  float t44_scale = length(t43_axis);
  float t45_drop = t41_dropB * t44_scale;
  float t46_offZ = t37_off.y;
  vec3 t47_bend = vec3(t38_offX, t45_drop, t46_offZ);
  vec3 t48_bent = t1_rel + t47_bend;`;
const OUTPUT = '  transformed = ((t83_position - wsCodecOrigin) / wsCodecStep);';

interface CoverMode {
  readonly parameter: string;
  readonly lodReach: string;
  readonly value: number;
}

export function rejectCollapsedCoverVertices(shader: string, mode: CoverMode): string {
  const test = `${farMode(mode.parameter)}\n${visibility(mode.lodReach)}`;
  const handover = handoverMode(mode.parameter);
  if (![START, ORIGIN, AXIS, `${test}\n${COLLAPSE}`, handover, OUTPUT].every(anchor => shader.includes(anchor))) return shader;
  if (!shader.includes('#include <project_vertex>') || shader.includes('gl_Position =')) return shader;
  return shader.replace(`${ORIGIN}\n`, '').replace(`${AXIS}\n`, '').replace(`${test}\n`, '')
    .replace(handover, `  const bool t111_handover = ${String(mode.value > 0.5)};`)
    .replace(START, `${ORIGIN}
${AXIS}
  const bool t49_isFar = ${String(mode.value > 1.5)};
${visibility(mode.lodReach)}
  if (t81_vis == 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
${START}`);
}

function useCoverPhase(shader: string): string {
  if (!shader.includes(AXIS) || !shader.includes(YAW)) return shader;
  return `attribute float ${COVER_PHASE_ATTRIBUTE};\n${shader.replace(YAW, `  float t67_h = ${COVER_PHASE_ATTRIBUTE};`)}`;
}

function coverHullRadius(geometry: BufferGeometry, scale: number): number | null {
  if (geometry.morphAttributes.position !== undefined) return null;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const sphere = geometry.boundingSphere, box = geometry.boundingBox;
  if (sphere === null || box === null || box.isEmpty()) return null;
  const height = Math.max(0, box.max.y);
  // Push is bounded by 1.1, wind by hypot(1.5, 0.6) * 0.23. Round the sum up.
  const offset = 1.5 * height;
  const drop = 0.4 * offset * height * scale;
  const bound = scale * (sphere.center.length() + sphere.radius) + offset + drop;
  return Number.isFinite(bound) ? bound * 1.01 + 0.05 : null;
}

function rejectCoverBehindCamera(shader: string): string {
  return `uniform float wsCoverHull;\n${shader.replace(ORIGIN, `  vec3 wsCoverViewZ = vec3(modelViewMatrix[0].z, modelViewMatrix[1].z, modelViewMatrix[2].z);
  vec3 wsCoverCentre = wsInstanceTransform(vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float wsCoverDepth = dot(wsCoverViewZ, wsCoverCentre) + modelViewMatrix[3].z;
  if (!isOrthographic && wsCoverDepth > wsCoverHull * length(wsCoverViewZ) && wsCodecStep == 1.0 && all(equal(wsCodecOrigin, vec3(0.0))) &&
      wsWindGust >= 0.0 && wsWindGust <= 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
${ORIGIN}`)}`;
}

/** At phone Low the tier owns a packed material shared by the front and back meshes. */
export function applyCoverVertexVariant(tier: InstanceTier, mode: CoverMode, settings: CoverVertexSettings, maxScale: number): void {
  const source = tier.shown.material;
  if (!(source instanceof ShaderMaterial) || Reflect.get(source, 'isGraphShaderMaterial') !== true || source.wireframe) return;
  const original = source.vertexShader;
  const reject = settings.reject || settings.behind ? rejectCollapsedCoverVertices(original, mode) : original;
  let shader = settings.reject ? reject : original;
  if (settings.behind && reject !== original && original.includes(DEFORMATION)) {
    const radius = coverHullRadius(tier.shown.geometry, maxScale);
    if (radius !== null) {
      source.uniforms['wsCoverHull'] = { value: radius };
      shader = rejectCoverBehindCamera(shader);
    }
  }
  source.vertexShader = settings.phase ? useCoverPhase(shader) : shader;
}
