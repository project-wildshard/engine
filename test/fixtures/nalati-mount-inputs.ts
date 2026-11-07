import type {SimHost} from '../../src/server/engine/sim';
import type {HeadlessRuntimeInstallation} from '../../src/server/host/headlessRuntime';
import {mountedPlayerOf} from '../../src/server/game/riding/native';
import {pickPrompt} from '../../src/shared/engine/world/interact/prompts';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

/** Fixture input edge for the actual registered camp mounts. No actor id or
 * forced mount crosses the tape: USE must reach a visible native prompt. */
export function installNalatiMountInputs(host:SimHost,context:Pick<HeadlessRuntimeInstallation,'commands'>):void {
  const mounted=mountedPlayerOf(host);if(mounted===undefined)throw new Error('Camp riding requires its native mounted owner');
  host.onStep('nalati.ride.input',()=>{
    for(const command of context.commands()){
      if(command.kind!=='script'||command.actorId!=='nalati.ride')continue;
      if(command.value!==1&&command.value!==2)throw new Error('Unknown native camp ride input');
      if(mounted.body.breaking)continue;
      if(command.value===2){if(mounted.mounted)mounted.dismount();continue;}
      if(mounted.mountables.length>64)throw new Error('Native camp mount roster exceeds its bound');
      const candidates=mounted.mountables.map(actor=>({actor,position:actor.position,
        radius:!actor.alive?0:mounted.horse===actor?3.6:mounted.mounted?0:3.3}));
      const at=leadPlayer(host).position,selected=pickPrompt(candidates,{x:at.x,y:at.y+1.68,z:at.z},host.physics);
      if(selected===undefined)continue;
      if(mounted.horse===selected.actor)mounted.dismount();else mounted.mount(selected.actor.entityId);
    }
  });
}
