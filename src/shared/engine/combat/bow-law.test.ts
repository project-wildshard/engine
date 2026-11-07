import { expect, test } from 'vitest';
import { MathUtils } from 'three';
import { DRAW_TIME } from './bowDraw';
import { drawnSpreadDegrees } from './shotSpread';
import { bowAimOn, bowBlocked, bowLaunchSpeed, bowLooseSpreadDegrees, bowMount, bowMuzzle, type BowLawProfile } from './bowLaw';

const riding: BowLawProfile = { aimSpread: 0.35, speedBase: 38, speedDraw: 24,
  loose: { degrees: 0.5, motion: 0.7, muzzle: 0.6, radius: 'sqrt', axisScale: 1 },
  mounted: { drawTime: 0.9, rearAngle: 110, rearDraw: 0.2, rearSpread: 1.4, arc: false, gaits: [{ below: 2, spread: 0 }, { below: 6, spread: 0.4 }, { below: Infinity, spread: 1.1 }] } };
const plain: BowLawProfile = { aimSpread: 0.4, speedBase: 30, speedDraw: 20 };

/** Bow.ts's law as it was inline before the kernel */
function inlineMount(profile: BowLawProfile, playerYaw: number, m: { speed: number; yaw: number } | null): unknown {
  if (m === null) return { draw: 1, spread: 0, arc: true, parthian: false, mounted: false, carrier: [0, 0, 0] };
  const mounted = profile.mounted; if (mounted === undefined) return null;
  const v = m.speed, gait = mounted.gaits.find((row) => v < row.below)?.spread ?? 0;
  let off = playerYaw - m.yaw; off = Math.abs(Math.atan2(Math.sin(off), Math.cos(off)));
  const parthian = off > MathUtils.degToRad(mounted.rearAngle);
  return { draw: (profile.draw?.drawTime ?? DRAW_TIME) / (mounted.drawTime + (parthian ? mounted.rearDraw : 0)), spread: gait + (parthian ? mounted.rearSpread : 0),
    arc: mounted.arc, parthian, mounted: true, carrier: [-Math.sin(m.yaw) * v, 0, -Math.cos(m.yaw) * v] };
}

test('the bow law blocks, aims, mounts, spreads and launches exactly as the inline bow did', () => {
  let seed = 21;
  const rnd = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 4000; i++) {
    const s = { enabled: rnd() < 0.9, cancel: rnd() < 0.1, bolts: Math.floor(rnd() * 3), sprinting: rnd() < 0.4, mounted: rnd() < 0.5, swimming: rnd() < 0.1 };
    const running = s.sprinting && !s.mounted;
    expect(bowBlocked(s)).toEqual({ running, blocked: !s.enabled || s.cancel || s.bolts <= 0 || running || s.swimming });
    const asked = rnd() < 0.5;
    expect(bowAimOn({ asked, enabled: s.enabled, running, swimming: s.swimming })).toBe(asked && s.enabled && !running && !s.swimming);
    const profile = rnd() < 0.8 ? riding : plain, yaw = (rnd() - 0.5) * 12, m = rnd() < 0.2 ? null : { speed: rnd() * 14, yaw: (rnd() - 0.5) * 12 };
    const law = bowMount(profile, yaw, m);
    expect(law === null ? null : { ...law, carrier: [law.carrier.x, law.carrier.y, law.carrier.z] }).toEqual(inlineMount(profile, yaw, m));
    const blend = rnd(), speed = rnd(), extra = rnd() * 2, mountSpread = rnd() * 3, p = rnd();
    expect(bowLooseSpreadDegrees(profile, blend, speed, extra, mountSpread))
      .toBe(drawnSpreadDegrees(profile.loose?.degrees ?? 0.3, profile.aimSpread, blend, profile.loose?.motion ?? 0.6, speed, extra, mountSpread));
    expect(bowLaunchSpeed(profile, p)).toBe(profile.speedBase + profile.speedDraw * p);
    expect(bowMuzzle(profile)).toBe(profile.loose?.muzzle ?? 0.55);
  }
});
