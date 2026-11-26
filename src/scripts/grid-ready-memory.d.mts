export function chromiumProcessPeaks(events:readonly unknown[]):{browser:number;renderer:number;gpu:number};
export function chromiumAllocatorBytes(events:readonly unknown[]):{pid:number;role:string;entries:{path:string;bytes:number;sizeBytes?:number;allocatedObjectsBytes?:number;url?:string;reasonNotDeletable?:string}[]}[];
export function ownedResidencyBytes(claims:readonly {id:string;owner:string;accountedBytes:number}[],instance:string,slug:string):number;
