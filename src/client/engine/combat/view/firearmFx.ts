import * as THREE from 'three';
/** muzzle flash sprite: a hot white core, orange petals, alpha in the luminance (additive) */
export function makeFlashTexture(): THREE.CanvasTexture {
  const S = 128, cvs = document.createElement('canvas'); cvs.width = cvs.height = S;
  const ctx = cvs.getContext('2d');
  if (ctx === null) throw new Error('makeFlashTexture: no 2d canvas context');
  ctx.clearRect(0, 0, S, S);
  const c = S / 2;
  // petals
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2 + 0.3, len = S * (0.32 + (k % 3) * 0.08), w = S * 0.07;
    ctx.save(); ctx.translate(c, c); ctx.rotate(a);
    const g = ctx.createLinearGradient(0, 0, len, 0);
    g.addColorStop(0, 'rgba(255,220,150,0.9)'); g.addColorStop(0.5, 'rgba(255,150,60,0.55)'); g.addColorStop(1, 'rgba(255,90,20,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, -w); ctx.quadraticCurveTo(len * 0.6, -w * 0.4, len, 0); ctx.quadraticCurveTo(len * 0.6, w * 0.4, 0, w); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  const core = ctx.createRadialGradient(c, c, 0, c, c, S * 0.3);
  core.addColorStop(0, 'rgba(255,255,240,1)'); core.addColorStop(0.35, 'rgba(255,230,170,0.9)'); core.addColorStop(1, 'rgba(255,140,50,0)');
  ctx.fillStyle = core; ctx.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(cvs); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ───────────────────────────── hitscan tracer ─────────────────────────────
