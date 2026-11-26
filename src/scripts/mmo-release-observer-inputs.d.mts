import type {ReleaseFile} from '../shared/host/releaseRows';

export class ObservationRefusedError extends Error {constructor(code:string,cause?:unknown);code:string;}
export interface ObservationInputOptions {
 publicKey:string;releaseUrl?:string;healthUrl?:string;bundleOrigin?:string;
 timeoutMs?:number;maxArtifactBytes?:number;signal?:AbortSignal;
}
export function observationInputs(options:ObservationInputOptions):{
 read:(signal?:AbortSignal,liveGenerations?:readonly number[])=>Promise<{release:ReleaseFile;ready:boolean;reason:string|null;health:{build:string;serial:number;players:number;cells:number;workers:number};verifiedBundle:true}>;
};
