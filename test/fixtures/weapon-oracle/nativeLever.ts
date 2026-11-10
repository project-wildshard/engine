// Frozen native installer at 28bc7527b, before data-frame adoption. Test oracle only.
import { worldHit } from '@wildshard/engine/physics/query';
import { LEVER_WEAPON_PROFILE } from '../engine-lift/nativeItemProfiles';
import * as v from 'valibot';
import { Vector3 } from 'three';
import type { SimHost } from '@wildshard/engine/sim';
import type { AnimalSim } from '@wildshard/engine/entities/AnimalSim';
import type { DamageRequest } from '@wildshard/engine/combat/pipeline';
import { instantSpreadDegrees, shotSpread } from '@wildshard/engine/combat/shotSpread';
import { smoothstep } from '@wildshard/engine/core/noise';
import { LeverAction, parseLeverProfile } from './leverBridge';
import { aimAt, bodyHit } from './headlessRanged';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

/** The lever-action's fixed-step id; its continuation is the action, the reserve and the dry pull's clock. */
export const LEVER_STEP = 'pine.lever';
/** The most shots a tick reads (the tick's command allowance). */
const MAX_SHOTS = 1024, NO_SHOTS: readonly string[] = [];

const finite = v.pipe(v.number(), v.finite()), count = v.pipe(v.number(), v.integer(), v.minValue(0));


/** What the rifle is lent: the tick's shots (the body each is aimed at), whether it is live (held, not mid-swap, not locked
 *  by a boss intro: its trigger and its auto reload) and the bodies a round can hit. */
export interface PineLeverPorts {
  /** Exact admitted firearm row. Isolated native callers default to the same authored Pine contract. */
  readonly profile?: unknown;
  readonly shots: () => readonly string[];
  readonly enabled: () => boolean;
  readonly bodies: () => readonly AnimalSim[];
  /** the tick's aim share along the target's body (headlessRanged.ts `aimAt`; absent: its middle) */
  readonly aim?: () => number;
  /** Actual page combat-input samples; absent retains the named standing/hip limitation. */
  readonly adsBlend?: () => number;
  readonly speedFactor?: () => number;
}

/**
 * PINE HOLLOW'S LEVER-ACTION in a renderer-free host (SF72), on the page's own action (weapons/leverAction.ts `LeverAction`,
 * which LeverRifle runs too) with its own 21-round reserve. A player command's `attack` pulls the trigger aimed at that
 * body's chest, as the engine's Firearm.tryFire: mid-reload it stops after the round in hand; mid-cycle nothing; an empty
 * chamber clicks dry (the auto reload's clock restarts) and throws the lever if the tube has a round, else starts a reload;
 * else the hammer drops and the round is the page's hitscan (combat/view/hitscan.ts): the hip cone (0.06° + 0.9°, √ radius,
 * four draws from the host's gameplay stream as the page's gameplayRandom), a ray through the world to 320 m, the
 * creatures' hitboxes short of the wall, and the damage model's blow ×1.5 through the host's combat pipeline. The step runs
 * the beat, the throw and the one-round-at-a-time reload, and the auto reload 0.35-5 s after a dry pull on an empty gun,
 * only while held. The full Pine installer lends authoritative moving spread; isolated callers without that port
 * keep standing input. Aim blending still requires the sampled sight input; visual kick remains on the page.
 */
export function installPineLever(host: SimHost, ports: PineLeverPorts): { readonly act: LeverAction; readonly store: { reserve: number } } {
  const profile = parseLeverProfile(ports.profile ?? LEVER_WEAPON_PROFILE);
  const Saved = v.strictObject({ tube: v.pipe(count, v.maxValue(profile.magazine - 1)), chambered: v.boolean(), caseInChamber: v.boolean(), hammerCocked: v.boolean(),
  phase: v.picklist(['idle', 'beat', 'cycle', 'reload']), phaseT: finite, fed: count, planned: count, stopAfter: v.boolean(), dryAtStart: v.boolean(),
  reloadProgress: finite, reserve: count, sinceEmpty: finite });
  const random = (): number => host.rng.stream('gameplay').next(), player = leadPlayer(host);
  const store = { reserve: profile.reserve }, act = new LeverAction(store, profile);
  const cone = { radius: profile.spreadRadius, axisScale: 1 } as const;
  let sinceEmpty = 99;
  const eye = new Vector3(), dir = new Vector3(), across = new Vector3(), end = new Vector3();
  const req: DamageRequest = { source: player.health, sourceTags: ['weapon.lever', 'dmg.ranged', 'cover.checked'], target: player.health, amount: 0, point: new Vector3(), dir, headshot: false };
  const hitscan = (target: AnimalSim): void => {
    aimAt(host, target, eye, dir, ports.aim?.());
    const a = smoothstep(0, 1, ports.adsBlend?.() ?? 0);
    const spread = instantSpreadDegrees(profile.spreadAds, profile.spreadHip, a, 0,
      ports.speedFactor?.() ?? 0, profile.movingSpread, profile.movingAimReduction) * (Math.PI / 180);
    shotSpread(dir, spread, random, cone, across);
    const wall = worldHit(host.physics, eye, end.copy(eye).addScaledVector(dir, profile.range), 0);
    const hit = bodyHit(ports.bodies(), eye, dir, wall ? wall.distance : profile.range), body = hit?.body ?? null;
    if (hit === null || body === null) return;
    req.target = body.combatActor(); req.amount = body.damageFor(hit.head, hit.distance) * profile.damageScale;
    req.point.copy(hit.point); req.headshot = hit.head;
    host.combat.hit(req);
  };
  const pull = (target: AnimalSim): void => {
    if (act.phase === 'reload') { act.triggerWhileReloading(); return; }
    if (act.phase !== 'idle') return;
    if (!act.chambered) { sinceEmpty = 0; if (act.tube > 0) act.throwLever(); else act.beginReload(); return; }
    act.dropHammer();
    hitscan(target);
  };
  host.onStep(LEVER_STEP, dt => {
    const live = ports.enabled(), shots = live ? ports.shots() : NO_SHOTS;
    for (let i = 0; i < MAX_SHOTS; i++) {
      const id = shots[i];
      if (id === undefined) break;
      const target = host.entities.get(id);
      if (target !== undefined) pull(target);
    }
    sinceEmpty += dt;
    act.step(dt, act.wantsAutoReload && sinceEmpty > profile.autoReload && sinceEmpty < profile.lever.autoReloadClose && ports.enabled());
  }, {
    snapshot: () => ({ tube: act.tube, chambered: act.chambered, caseInChamber: act.caseInChamber, hammerCocked: act.hammerCocked, phase: act.phase, phaseT: act.phaseT,
      fed: act.fed, planned: act.planned, stopAfter: act.stopAfter, dryAtStart: act.dryAtStart, reloadProgress: act.reloadProgress, reserve: store.reserve, sinceEmpty }),
    restore: value => {
      const s = v.parse(Saved, value);
      Object.assign(act, { tube: s.tube, chambered: s.chambered, caseInChamber: s.caseInChamber, hammerCocked: s.hammerCocked, phase: s.phase, phaseT: s.phaseT,
        fed: s.fed, planned: s.planned, stopAfter: s.stopAfter, dryAtStart: s.dryAtStart, reloadProgress: s.reloadProgress });
      store.reserve = s.reserve; sinceEmpty = s.sinceEmpty;
    },
  }, 'afterBodies');
  return { act, store };
}
