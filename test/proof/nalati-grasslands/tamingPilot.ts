import type {SimHost} from '../../../src/server/engine/sim';
import type {HeadlessCommand} from '../../../src/shared/host/tickProtocol';
import {nativeTamingOf} from '../../../src/server/game/riding/nativeTaming';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

/** The pilot observes only the living horse position, live prompt and balance gauge. No trust/position grants or forceBreak. */
export function nalatiTamingPilot(host: SimHost, stallionId: string, previousBalance: number): { balance: number; commands: HeadlessCommand[] } {
  const taming = nativeTamingOf(host), original = host.entities.get(stallionId);
  if(taming===undefined)throw new Error('Missing native taming owner');
  if (original === undefined) throw new Error('Missing original living stallion');
  let x = 0, z = 0, sneak = true;
  if (taming.phase !== 'breaking') {
    const dx = original.position.x - leadPlayer(host).position.x, dz = original.position.z - leadPlayer(host).position.z, length = Math.hypot(dx, dz);
    if (length > 2.2) { x = dx / length; z = dz / length; }
    sneak = length < 8; // at the page's 4.3 m/s the walk still catches a grazing horse; the crouch is for the last steps
  }
  const balance = taming.view.balance, lean = Math.max(-1, Math.min(1, balance * 12 + (balance - previousBalance) * 60 * 3));
  return { balance, commands: [{ kind: 'player', moveX: x, moveZ: z, yaw: 0, commandVersion: 1, crouch: sneak,
    steer: { keyX: x, keyY: -z, stickX: 0, stickY: 0 } },
  { kind: 'script', actorId: 'nalati.taming.offer', value: 1 }, { kind: 'script', actorId: 'nalati.taming.lean', value: lean },
  ...(taming.interactable.radius > 0 ? [{ kind: 'script' as const, actorId: 'nalati.taming.mount', value: 1 }] : [])] };
}

/** Keep the observed gauge velocity between its actual 10 Hz publications.
 * Re-reading the same gauge at 60 Hz must not erase the latest movement. */
export function createNalatiTamingPilot(): (host:SimHost,stallionId:string)=>HeadlessCommand[] {
  let breaking=false,balance=0,speed=0,sampledTick=0;
  return (host,stallionId)=>{
    const taming=nativeTamingOf(host);if(taming===undefined)throw new Error('Missing native taming owner');
    const pilot=nalatiTamingPilot(host,stallionId,balance);
    if(taming.phase!=='breaking'){breaking=false;balance=pilot.balance;speed=0;return pilot.commands;}
    if(!breaking){breaking=true;balance=pilot.balance;speed=0;sampledTick=host.state.tick;}
    if(pilot.balance!==balance){speed=(pilot.balance-balance)/((host.state.tick-sampledTick)/60);balance=pilot.balance;sampledTick=host.state.tick;}
    const lean=Math.max(-1,Math.min(1,balance*2+speed*1.1));
    return pilot.commands.map(command=>command.kind==='script'&&command.actorId==='nalati.taming.lean'
      ?{kind:'script',actorId:command.actorId,value:lean}:command);
  };
}
