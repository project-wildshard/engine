import { expect, test } from 'vitest';
import * as THREE from 'three';
import { easeViewToward } from '@wildshard/engine/ai/BossBrain';

/** Boss.faceToward as it was inline before the extraction (verbatim) */
function inline(pl: { yaw: number; pitch: number }, camera: THREE.Vector3, target: THREE.Vector3, dt: number): void {
  const to = new THREE.Vector3().copy(target).sub(camera);
  const yaw = Math.atan2(-to.x, -to.z), pitch = Math.atan2(to.y, Math.hypot(to.x, to.z));
  let dy = yaw - pl.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  const k = 1 - Math.exp(-dt * 3.2);
  pl.yaw += dy * k;
  pl.pitch += (THREE.MathUtils.clamp(pitch, -0.6, 0.8) - pl.pitch) * k;
}

test('the intro view ease turns yaw and pitch exactly as the page Boss did', () => {
  let seed = 9;
  const rnd = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let run = 0; run < 40; run++) {
    const a = { yaw: (rnd() - .5) * 20, pitch: (rnd() - .5) * 3 }, b = { ...a };
    const camera = new THREE.Vector3((rnd() - .5) * 200, rnd() * 40, (rnd() - .5) * 200);
    const target = new THREE.Vector3((rnd() - .5) * 200, rnd() * 60, (rnd() - .5) * 200);
    for (let frame = 0; frame < 90; frame++) {
      const dt = rnd() * .1;
      if (frame % 30 === 29) target.set(camera.x, camera.y + (rnd() - .5) * 50, camera.z); // straight above / below
      inline(a, camera, target, dt); easeViewToward(b, camera, target, dt);
      expect([b.yaw, b.pitch]).toEqual([a.yaw, a.pitch]);
    }
  }
});
