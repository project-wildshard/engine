import {afterEach} from 'vitest';
import {Scope} from '../../src/shared/engine/app/scope';
import {liveAdmissionPage, liveTitanPrograms} from './liveNalati';
export {lendLiveNalati as lendNalatiPasture} from './liveNalati';
/** ZONE-SNAPSHOTS ZS9 (J507): Nalati's live pasture wind guest. */
export const pasture=liveTitanPrograms.wind;
const owners:Scope[]=[];
afterEach(()=>{for(const owner of owners.splice(0))owner.dispose();});
/** Preserve the original optional-owner admission helper and per-case disposal. */
export function admissionPage(owner?:Scope){
 if(owner===undefined){owner=new Scope('admission.fixture');owners.push(owner);}
 return liveAdmissionPage(owner);
}
