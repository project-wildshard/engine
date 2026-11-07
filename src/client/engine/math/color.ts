import * as THREE from 'three';

/** an sRGB hex colour as a linear colour, times `k` (10 §X5: the one `lin`; ×1 leaves every channel exact) */
export function lin(hex: number, k = 1): THREE.Color {
  return new THREE.Color(hex).convertSRGBToLinear().multiplyScalar(k);
}
