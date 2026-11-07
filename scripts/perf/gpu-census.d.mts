/** Run native-card legacy/shardfile frozen-frame measurements from process.argv. */
export function runGpuCensus():Promise<void>;

/** Authored standing camera supplied by the CLI, never loaded on import. */
export interface GpuCensusCamera {readonly n:number;readonly fov:number;readonly probe:{readonly x:number;readonly y:number;readonly z:number;readonly yaw:number;readonly pitch:number}}
export function gpuCensusPoses(slug:string,selected:readonly string[],cameras?:readonly GpuCensusCamera[]):readonly {id:string;x:number;y?:number;z:number;yaw:number;pitch:number;fov?:number;hover?:boolean;source?:string}[];
