export interface WorldPixelDifference {
 readonly pixels:number;readonly approvedPixels:number;readonly unapprovedPixels:number;
 readonly first:readonly {readonly x:number;readonly y:number;readonly before:readonly number[];readonly after:readonly number[];readonly approved:boolean}[];
}
export function worldPixelDifference(a:Uint8Array,b:Uint8Array,width:number,height:number,pose:string,g941?:boolean):WorldPixelDifference;
