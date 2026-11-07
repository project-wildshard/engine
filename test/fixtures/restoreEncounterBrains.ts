/** Reconnect the encounter's original callbacks only after the enclosing
 * native bank has restored and cleared its shared registry. No actor state,
 * clock or behavior executes here; a competing owner refuses atomically. */
export function restoreEncounterBrains<A extends object,B extends object>(owned:ReadonlyMap<A,B>,shared:Map<A,B>,live:(actor:A)=>boolean):void {
  const entries=[...owned];
  for(const [actor,brain]of entries){
    const current=shared.get(actor);
    if(!live(actor)||current!==undefined&&current!==brain)throw new Error('Changed encounter brain owner');
  }
  for(const [actor,brain]of entries)shared.set(actor,brain);
}
