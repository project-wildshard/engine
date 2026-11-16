import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { patchShader } from './shaderPatches';

const CYAN = 0x8fe3ff;
const NL = '\n';
const LEN = 0.9, WID = 0.28, THICK = 0.032;

function roundedRect(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/**
 * The board, built into `g` (the viewmodel's model, or the Model Explorer's specimen: src/client/engine/models/hoverboard.ts, E348): the
 * deck, its grip, the edge strip, the nose lamp and the inlay, the two repulsor discs and their glow halos, in that order.
 * `pulse` and `glow` are the materials the viewmodel animates.
 * NINE-DRAGON-BENCHMAX NB8: two meshes, two draws, not 11 (the board under you added 12 to the phone's walk): every solid
 * part in one, each vertex carrying its part's colour, roughness, metalness and emissive kind (`pulse`, whose emissive
 * lights the strip, lamp and inlay only); both halos in the other, drawn over both faces in one pass.
 */
export function buildHoverboard(g: THREE.Group): { pulse: THREE.MeshStandardMaterial; glow: THREE.MeshBasicMaterial } {
  // deck: rounded plank, extruded in XY then laid flat (length along −z = camera forward)
  const deckShape = roundedRect(WID, LEN, 0.11);
  const deckGeo = new THREE.ExtrudeGeometry(deckShape, { depth: THICK, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2, curveSegments: 10 });
  deckGeo.rotateX(-Math.PI / 2); deckGeo.translate(0, -THICK / 2, 0);
  // grip: a slightly lighter matte inset on the top face
  const gripGeo = new THREE.ExtrudeGeometry(roundedRect(WID - 0.06, LEN - 0.1, 0.08), { depth: 0.004, bevelEnabled: false, curveSegments: 8 });
  gripGeo.rotateX(-Math.PI / 2); gripGeo.translate(0, THICK / 2 + 0.002, 0);
  // edge strip: an emissive ring around the deck's top rim, proud of the deck (out 10 mm, up 8 mm) so it reads from the rider's grazing angle
  const ring = roundedRect(WID + 0.02, LEN + 0.02, 0.12);
  ring.holes.push(roundedRect(WID - 0.024, LEN - 0.024, 0.098));
  const stripGeo = new THREE.ExtrudeGeometry(ring, { depth: 0.016, bevelEnabled: false, curveSegments: 10 });
  stripGeo.rotateX(-Math.PI / 2); stripGeo.translate(0, THICK / 2 - 0.008, 0);
  // nose lamp across the front tip + a centre inlay line down the deck (the strip's pulsing look)
  const lampGeo = new THREE.BoxGeometry(0.15, 0.01, 0.028); lampGeo.translate(0, THICK / 2 + 0.006, -LEN / 2 + 0.075);
  const inlayGeo = new THREE.BoxGeometry(0.014, 0.006, LEN * 0.66); inlayGeo.translate(0, THICK / 2 + 0.006, 0.02);
  // repulsor discs underneath, front and back, plus a soft additive glow halo under each
  const ends = [-LEN * 0.3, LEN * 0.3];
  const discGeos = ends.map(z => new THREE.CylinderGeometry(0.075, 0.095, 0.022, 24).translate(0, -THICK / 2 - 0.02, z));
  // every solid part in one mesh, in the order the parts drew, each vertex carrying its part's look (colour, roughness,
  // metalness, emissive kind): `pulse`'s emissive lights the strip, lamp and inlay; the discs burn a fixed cyan
  const pulse = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, emissive: CYAN, emissiveIntensity: 2.2, roughness: 0.4, metalness: 0 });
  const discEmissive = new THREE.Color(CYAN).multiplyScalar(3);
  patchShader(pulse, 'nb8-hoverboard', 0, (shader): void => {
    shader.uniforms['uDiscEmissive'] = { value: discEmissive };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>${NL}attribute vec3 aBoard;${NL}varying vec3 vBoard;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>${NL}vBoard = aBoard;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>${NL}uniform vec3 uDiscEmissive;${NL}varying vec3 vBoard;`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vBoard.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vBoard.y;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>${NL}totalEmissiveRadiance = vBoard.z < 0.5 ? vec3(0.0) : vBoard.z < 1.5 ? totalEmissiveRadiance : uDiscEmissive;`);
  }, { key: 'nb8-hoverboard' });
  g.add(new THREE.Mesh(joined([
    looked(deckGeo, 0x1a1d24, 0.55, 0.35, 0), looked(gripGeo, 0x2b303a, 0.95, 0.05, 0),
    looked(stripGeo, 0x0a1a22, 0.4, 0, 1), looked(lampGeo, 0x0a1a22, 0.4, 0, 1), looked(inlayGeo, 0x0a1a22, 0.4, 0, 1),
    ...discGeos.map(geometry => looked(geometry, 0x0d2a36, 0.3, 0.2, 2)),
  ]), pulse));
  // fogless (a metre from the eye fog is nil): the weapon tracer glow's two programs instead of two of its own. Additive with
  // no depth write, so one pass over both faces draws what three's back-then-front pair drew.
  const glow = new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  glow.forceSinglePass = true;
  g.add(new THREE.Mesh(joined(ends.map(z => new THREE.CircleGeometry(0.15, 24).rotateX(-Math.PI / 2).translate(0, -THICK / 2 - 0.045, z))), glow));
  return { pulse, glow };
}

/** a part non-indexed, its look on every vertex: `color` (linear, as a material colour holds it) and `aBoard` (roughness,
 *  metalness, emissive kind: 0 none, 1 the pulse, 2 the discs' fixed cyan) */
function looked(part: THREE.BufferGeometry, colour: number, roughness: number, metalness: number, emissive: 0 | 1 | 2): THREE.BufferGeometry {
  const geometry = part.index === null ? part : part.toNonIndexed();
  if (geometry !== part) part.dispose();
  const n = geometry.getAttribute('position').count, c = new THREE.Color(colour), colours = new Float32Array(n * 3), looks = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { colours.set([c.r, c.g, c.b], i * 3); looks.set([roughness, metalness, emissive], i * 3); }
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  geometry.setAttribute('aBoard', new THREE.BufferAttribute(looks, 3));
  return geometry;
}

/** parts baked in place into one geometry (the sources are disposed) */
function joined(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts);
  if (merged === null) throw new Error('hoverboard: parts do not merge');
  for (const part of parts) part.dispose();
  return merged;
}
