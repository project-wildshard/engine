import type { FloorGridPlan, FloorGridWitness } from '../frame-floor-grid.mjs';

export interface PhoneCell {readonly instance:string;readonly slug:string;readonly cell:readonly[number,number];readonly shows:string;readonly drawn:{readonly far:boolean;readonly near:boolean;readonly l0:number;readonly l1:number}}
export interface PhoneGrid {home:string;pitch:number;inside:string|null;cells:readonly PhoneCell[];live:{live:{gameplayReady:boolean;current:string|null;worldFeet:{x:number;y:number;z:number}}}|null;frame:{chain:{fx:{grain:number}|null}}|null}
export interface PhoneObservation {
  at:number; frame:number; frameAt:number|null; ready:boolean; current:string|null; inside:string|null; home:string; pitch:number;
  feet:{x:number;y:number;z:number}|null; cells:readonly PhoneCell[]; grain:number; frameAvailable:boolean;
  hover:boolean; fps:number; pill:string|null; fatal:(string|null)[]; contextLost:boolean;
}
export interface PhoneEntry { at:number; frame:number; inside:string|null; current?:string|null; ready?:boolean; cell?:PhoneCell; grain:number }
export interface PhoneWallSurface {width:number;height:number;normal:{x:number;y:number;z:number}}
export interface PhoneWallTarget {direction:{x:number;z:number};collider:number;material:string|null;surface:PhoneWallSurface;approach:{x:number;z:number}}
export interface PhoneWall { from:{x:number;y:number;z:number}; wallDistance:number; direction:{x:number;z:number};collider:number;material:string|null;surface:PhoneWallSurface;elapsedMs:number; startedFrame:number; finalFrame:number;
  final:{x:number;y:number;z:number}; hover:boolean; samples:{ms:number;x:number;z:number;hover:boolean;frame:number}[]; previous:{yaw:number;hover:boolean} }
export interface PhoneFps { label:string; elapsedMs:number; frames:number; worstMs:number; pillFps:number; pill:string|null }
export interface PhonePage {
  engine:'simulator-safari'|'webkit-iphone'; faults:string[];
  cold:(url:string,paintScript:string)=>Promise<void>; click:(selector:string)=>Promise<void>;
  /** Reattach only after an intentional UI action navigates to this exact document. */
  followNavigation:(url:string,previous:PhoneDocument,deadline:number)=>Promise<void>;
  evaluate:(expression:string)=>Promise<unknown>; screenshot:(path:string)=>Promise<Buffer>; close:()=>Promise<void>;
}
export interface PhoneDocument {readonly url:string;readonly visit:string;readonly document:string;readonly boot:string}
export function enterPhoneGrid(page:Pick<PhonePage,'evaluate'|'click'|'followNavigation'>,url:string,deadline:number):Promise<void>;
export function capturePhoneFailure(page:Pick<PhonePage,'screenshot'>,path:string):Promise<void>;
/** Passive timestamps from the existing Image probe and two-frame witness.
 * Probe load is not CSS decode or a compositor presentation timestamp. */
export interface PhoneTitlePhases {
  visibleMs:number|null; probeStartedMs:number|null; probeLoadedMs:number|null; firstFrameMs:number|null;
  resources:{kind:string;start:number;responseStart:number;responseEnd:number;transferBytes:number;encodedBytes:number;decodedBytes:number}[];
}
export interface PhoneReceipt {
  protocol:string; route?:'full'|'entry'; rollout?:string; sha:string; version:{build:string}; engine:PhonePage['engine']; steps:string[];
  paint:{heroMs:number|null;fcpMs:number|null;heroURL:string|null;phases?:PhoneTitlePhases}; entry:PhoneEntry|null; wall:PhoneWall|null;
  fps:PhoneFps[]; observations:PhoneObservation[]; frames:{label:string;width:number;height:number;darkShare:number}[];
  faults:string[]; routes:FloorGridWitness[]; failures:string[]; stop?:unknown; boot?:unknown;
}
export function phoneRoutePlans(state:PhoneObservation):{market:string;plans:FloorGridPlan[]};
export function phoneRouteFailures(receipt:PhoneReceipt):string[];
export function phoneRoute(page:PhonePage,base:string,sha:string,out:string,route?:'full'|'entry'):Promise<PhoneReceipt>;

/** Await the native page condition within one Inspector evaluation. */
export function waitPhoneCondition(page:Pick<PhonePage,'evaluate'|'faults'>,expression:string|(()=>()=>boolean),label:string,deadline:number):Promise<void>;
