/** Restore the exact previous catalogue slot after this file finishes. */
export function preserveCatalogue(registerCleanup:(cleanup:()=>void)=>unknown):void{
 const slot=Symbol.for('game.shards'),previous=Object.getOwnPropertyDescriptor(globalThis,slot);
 registerCleanup(()=>{if(previous===undefined)Reflect.deleteProperty(globalThis,slot);else Object.defineProperty(globalThis,slot,previous);});
}
