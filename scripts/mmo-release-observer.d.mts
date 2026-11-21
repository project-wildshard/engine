import type NodeWebSocket from 'ws';

export class StagingSocket extends NodeWebSocket {
 constructor(url:string,protocols:string[]);
}
export function observerArguments(args:string[],root?:string):{seconds:number;base:string};
export function runObserver(args:string[],root?:string):Promise<number>;
export function observerIdentities(base:string):[string,string];
