export interface GpuTime {whole:number;cpu:number}
export interface GpuMaterial {name:string;type:string;uuid:string;alphaTest:number;transparent:boolean;depthTest:boolean;depthWrite:boolean;passes:string[];groups:string[];objects:string[];draws:number;viewportPixelUpperBound:number;fullscreenPixels:number;fragmentShader:string|null}
export interface GpuInventory {materials:GpuMaterial[];calls:number;triangles:number}
export interface GpuEnvironment {renderer:string;buffer:number[];timer:string;camera:{world:number[];projection:number[];fov:number;aspect:number};player:number[];frame:number;programs:number|undefined;passes:{index:number;name:string;effects:string[]}[]}
export interface GpuCensusPort {
 batch:{(want:'throughput',frames?:number,variant?:string):GpuTime;(want:'inventory',frames?:number,variant?:string):GpuInventory};
 restore:()=>void;
 environment:()=>GpuEnvironment;
}
export function installGpuProbe():GpuEnvironment;
declare global {interface Window {__gpuCensus:GpuCensusPort}}
