export interface GpuPair {baseline:number;off:number;baselineCpu:number;offCpu:number}
export function gpuPairs(pairs:GpuPair[]):GpuPair&{saved:number;pairs:GpuPair[]};
export function gpuPhoneModel(macThroughputMs:number,phoneFrameMs:number):{kind:string;macThroughputMs:number;phoneFrameMs:number;factor:number;officialTimingCredit:false};
