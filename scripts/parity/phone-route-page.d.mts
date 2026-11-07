import type {PhoneObservation,PhoneWall,PhoneWallTarget} from './phone-route.mjs';

export function phoneTouchButton(selector:string):boolean;
export function phoneGridEntryCondition():()=>boolean;
export function phoneLoadingObservation():unknown;
export function phoneRouteObservation():PhoneObservation|null;
export function watchPhoneEntry(instance:string):void;
export function phoneWallTarget():PhoneWallTarget;
export function phoneBoardWall(milliseconds:number,target:PhoneWallTarget):Promise<PhoneWall>;
export function installPhoneTitlePaint(titleURL?:string):void;
