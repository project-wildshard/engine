import {lendNalatiRiding,ridingWitnessBytes} from './nalati-riding-loan';
import {TamingBinding as LegacyTamingBinding} from './tamingLegacyBinding';
import { Vector3 } from 'three';
import { TamingSession as TamingBinding } from '../../src/shared/game/riding/taming';
import { Scope } from '../../src/shared/engine/app/scope';
import type { TamingHorse, TamingHerd, TamingServices } from '../../src/shared/game/riding/bindingTypes';
import { NALATI_RIDING_PROGRAMS as programs } from './nalati-riding';

export function tamingRig(saved: string | null = null, actorId='wild',companionId:string|null=null,kind='ordinary',scale=1,legacy=false,scope=new Scope('taming-order'),draws:readonly number[]=[.25]) {
  const events: string[] = [];
  const horse = (id: string, kind: string): TamingHorse => ({ entityId: id, kind, scale, alive: true, yaw: .7,
    position: new Vector3(0, 0, 0), mem: {}, headWorld: out => out.set(0, 1.5, 0),
    setMotion: () => { events.push('motion'); } });
  const stallion = horse(actorId, saved === null ? kind : 'upgraded');
  const herd: TamingHerd<TamingHorse> = { stallion, stallionState: 'beaten', cx: 0, cz: 0, trust: 100, alert: 0, alertOwned: false, mode: 'graze',
    addTrust(value) { events.push(`trust:${String(value)}`); this.trust = Math.max(0, Math.min(100, this.trust + value)); },
    leadAway: () => { events.push('lead'); }, releaseStallion: () => { events.push('release'); } };
  let mounted: TamingHorse | null = null, acceptsMount = false, yaw = 2, pitch = .4, spawned = 0, drawIndex=0;
  const hud = { offer: false, lean: 0 };
  const opts: TamingServices<TamingHorse, TamingHerd<TamingHorse>> = {
    profile: { upgradeKind: 'upgraded', bonds: ['bond', 'better-bond'], names: ['Companion', 'Better companion'], offset: [0, 0],
      fields: { upgraded: 'argymaq', horseUpgraded: 'horseArgymaq', candidateUpgraded: 'argymaq' },
      labels: { mount: 'Mount', breaking: 'Tame', trust: 'Trust', start: 'Start', thrown: 'Thrown', bonded: ['Bonded', 'Better bonded'] } },
    programs, bond: { read: () => saved, write: value => { events.push(`write:${value}`); } },
    player: { position: new Vector3(0, 0, 2), crouching: true, keys: new Set(),
      get yaw() { return yaw; }, set yaw(value) { events.push('yaw'); yaw = value; },
      get pitch() { return pitch; }, set pitch(value) { events.push('pitch'); pitch = value; },
      camera: { position: new Vector3(0, 1.5, 2), getWorldDirection: out => out.set(0, 0, -1) } },
    mount: { get mounted() { return mounted !== null; }, get horse() { return mounted; }, breakRoll: 0, breakShake: 0,
      mount: (actor, breaking) => { events.push(`mount:${actor.entityId}:${String(breaking === true)}`); if (!acceptsMount) return false; mounted = actor; return true; },
      dismount: thrown => { events.push(`dismount:${String(thrown === true)}`); mounted = null; },
      addMountable: actor => { events.push(`add:${actor.entityId}`); }, removeMountable: actor => { events.push(`remove:${actor.entityId}`); } },
    hud, herds: () => [herd], rest: { x: 0, z: 0, face: { x: 0, z: 1 } }, wind: () => ({ x: 0, z: 1, strength: 1 }),
    random: () => { events.push('random'); return draws[drawIndex++%draws.length]??.25; },
    spawnBonded: () => { const actor = horse(companionId??`bonded-${String(++spawned)}`,kind); events.push(`spawn:${actor.entityId}`); return actor; },
    hideStallion: actor => { events.push(`hide:${actor.entityId}`); }, retireBonded: actor => { events.push(`retire:${actor.entityId}`); },
    hurt: value => { events.push(`hurt:${String(value)}`); }, toast: value => { events.push(`notice:${value}`); },
  };
  lendNalatiRiding(scope);
  const bytes=Buffer.from(ridingWitnessBytes).toString('base64');
  const binding = legacy?new LegacyTamingBinding({...opts,programs:{...programs,approach:{script:programs.approach.script,bytes},breaking:{script:programs.breaking.script,bytes},riding:{script:programs.riding.script,bytes}}}):new TamingBinding(opts,scope);
  binding.onBreaking = on => { events.push(`breaking:${String(on)}`); };
  binding.onBonded = actor => { events.push(`bonded:${actor.entityId}`); };
  binding.update(.1); events.length = 0;
  return { binding, events, hud, opts, herd, scope, allowMount: () => { acceptsMount = true; }, loseMount: () => { mounted = null; } };
}
