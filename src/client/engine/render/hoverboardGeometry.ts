import * as THREE from 'three';

const CYAN = 0x8fe3ff;
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
 * `pulse` (the strip, the lamp, the inlay) and `glow` (the halos) are the materials the viewmodel animates.
 */
export function buildHoverboard(g: THREE.Group): { pulse: THREE.MeshStandardMaterial; glow: THREE.MeshBasicMaterial } {
  // deck: rounded plank, extruded in XY then laid flat (length along −z = camera forward)
  const deckShape = roundedRect(WID, LEN, 0.11);
  const deckGeo = new THREE.ExtrudeGeometry(deckShape, { depth: THICK, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2, curveSegments: 10 });
  deckGeo.rotateX(-Math.PI / 2); deckGeo.translate(0, -THICK / 2, 0);
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x1a1d24, roughness: 0.55, metalness: 0.35 });
  const deck = new THREE.Mesh(deckGeo, deckMat);
  g.add(deck);
  // grip: a slightly lighter matte inset on the top face
  const gripGeo = new THREE.ExtrudeGeometry(roundedRect(WID - 0.06, LEN - 0.1, 0.08), { depth: 0.004, bevelEnabled: false, curveSegments: 8 });
  gripGeo.rotateX(-Math.PI / 2); gripGeo.translate(0, THICK / 2 + 0.002, 0);
  g.add(new THREE.Mesh(gripGeo, new THREE.MeshStandardMaterial({ color: 0x2b303a, roughness: 0.95, metalness: 0.05 })));
  // edge strip: an emissive ring around the deck's top rim, proud of the deck (out 10 mm, up 8 mm) so it reads from the rider's grazing angle
  const ring = roundedRect(WID + 0.02, LEN + 0.02, 0.12);
  ring.holes.push(roundedRect(WID - 0.024, LEN - 0.024, 0.098));
  const stripGeo = new THREE.ExtrudeGeometry(ring, { depth: 0.016, bevelEnabled: false, curveSegments: 10 });
  stripGeo.rotateX(-Math.PI / 2); stripGeo.translate(0, THICK / 2 - 0.008, 0);
  const pulse = new THREE.MeshStandardMaterial({ color: 0x0a1a22, emissive: CYAN, emissiveIntensity: 2.2, roughness: 0.4, metalness: 0 });
  g.add(new THREE.Mesh(stripGeo, pulse));
  // nose lamp across the front tip + a centre inlay line down the deck (same pulsing material)
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.01, 0.028), pulse); lamp.position.set(0, THICK / 2 + 0.006, -LEN / 2 + 0.075); g.add(lamp);
  const inlay = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.006, LEN * 0.66), pulse); inlay.position.set(0, THICK / 2 + 0.006, 0.02); g.add(inlay);
  // repulsor discs underneath, front and back, plus a soft additive glow halo under each
  const discGeo = new THREE.CylinderGeometry(0.075, 0.095, 0.022, 24);
  const discMat = new THREE.MeshStandardMaterial({ color: 0x0d2a36, emissive: CYAN, emissiveIntensity: 3, roughness: 0.3, metalness: 0.2 });
  const haloGeo = new THREE.CircleGeometry(0.15, 24); haloGeo.rotateX(-Math.PI / 2);
  const glow = new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }); // fogless (a metre from the eye fog is nil): the weapon tracer glow's two programs instead of two of its own
  for (const z of [-LEN * 0.3, LEN * 0.3]) {
    const d = new THREE.Mesh(discGeo, discMat); d.position.set(0, -THICK / 2 - 0.02, z); g.add(d);
    const h = new THREE.Mesh(haloGeo, glow); h.position.set(0, -THICK / 2 - 0.045, z); g.add(h);
  }
  return { pulse, glow };
}
