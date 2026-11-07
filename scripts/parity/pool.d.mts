import type { Browser } from 'playwright';

export function parallel<T,R>(items:T[],jobs:number,task:(item:T,index:number,slot:number)=>Promise<R>,onIdle?:(slot:number)=>Promise<void>):Promise<R[]>;
export function browserPool(root:string,jobs:number,angle:string,captureRpc?:boolean):{browser:(slot:number)=>Promise<Browser>;release:(slot:number)=>Promise<void>;close:()=>Promise<void>};
