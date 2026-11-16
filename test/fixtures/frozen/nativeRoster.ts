import {afterEach} from 'vitest';
import {Scope} from '../../../src/shared/engine/app/scope';
import {frozenAdmissionPage} from './runtimeBehavior';
export {lendFrozenPasture as lendNalatiPasture} from './runtimePrograms';
import {frozenTitanPrograms} from './runtimePrograms';
export const pasture=frozenTitanPrograms.wind;
const owners:Scope[]=[];
afterEach(()=>{for(const owner of owners.splice(0))owner.dispose();});
/** Preserve the original optional-owner admission helper and per-case disposal. */
export function admissionPage(owner?:Scope){
 if(owner===undefined){owner=new Scope('admission.fixture');owners.push(owner);}
 return frozenAdmissionPage(owner);
}
