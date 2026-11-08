import { parseLootEconomy } from '@wildshard/format/lootEconomy';
import type { Shardfile } from '@wildshard/format/shardSchema';
import type { SimHost } from '@wildshard/engine/sim';
import type { PlayerSim } from '@wildshard/engine/sim/playerSim';
import { isOwnedId, isCosmetic, type Owned } from '../../../shared/game/loot/Owned';

type Grants = NonNullable<Shardfile['items']['loadout']['effects']>['player'];
const weaponEffects = new WeakMap<SimHost, (player: PlayerSim, weapon: string, attr: string, base: number) => number>();
/** The actual source asks before its rounding, including its authored heavy move. */
export function ownedWeaponAttribute(host: SimHost, player: PlayerSim, weapon: string, attr: string, base: number): number {
  return weaponEffects.get(host)?.(player, weapon, attr, base) ?? base;
}

/** Numeric grants belong to the same authoritative book that accepted the purchase.
 * Other seats never inherit this device owner's gear. No page service or UI is installed. */
export function installOwnedEffects(host: SimHost, owned: Owned, source: Shardfile): void {
  const row=source.items.loadout.effects, raw=source.rows.loot.find(entry=>entry.economy!==undefined)?.economy;
  if(row===undefined || raw===undefined || row.player.length===0&&row.worn.length===0&&row.weapons.length===0&&row.hitCap===undefined) return;
  const economy=parseLootEconomy(raw), definitions=new Map(economy.effects.map(effect=>[effect.id,effect]));
  const [player]=host.players.values();if(player===undefined) throw new Error('Owned effects require their player');
  const select=(grants:Grants,worn=false): {def:typeof economy.effects[number];stacks:number}[] => {
    const active=new Map<string,{def:typeof economy.effects[number];stacks:number}>();
    for(const grant of grants) {
      if(!isOwnedId(grant.key)||!owned.has(grant.key)||worn&&(!isCosmetic(grant.key)||!owned.worn(grant.key))
        ||grant.unless?.some(key=>isOwnedId(key)&&owned.has(key))===true) continue;
      const def=definitions.get(grant.id);if(def===undefined) throw new Error('Missing owned effect definition');
      for(const [id,prior] of active) if(def.removes?.includes(prior.def.id)===true||def.group!==undefined&&prior.def.group===def.group) active.delete(id);
      active.set(def.id,{def,stacks:typeof def.stacking==='object'?Math.min(def.stacking.max,grant.stacks??1):1});
    }
    return [...active.values()];
  };
  const fold=(effects:ReturnType<typeof select>,attr:string,base:number):number=>{
    let value=base;
    for(const {def,stacks} of effects) for(let stack=0;stack<stacks;stack++) for(const mod of def.modifiers) if(mod.attr===attr)
      value=mod.op==='add'?value+mod.value:mod.op==='mul'?value*mod.value:mod.value;
    return value;
  };
  const weapon=(id:string)=>row.weapons.find(entry=>entry.items.some(item=>{
    const equipment=source.items.rows.find(value=>value.id===item)?.equipment;
    return item===id||equipment?.id===id||equipment?.legacySlot===id;
  }));
  const read=(who:PlayerSim,id:string,attr:string,base:number):number=>who===player?fold(select(weapon(id)?.grants??[]),attr,base):base;
  weaponEffects.set(host,read);host.scope.onDispose(()=>{weaponEffects.delete(host);});
  const baseMax=player.health.attributes.maxHealth,baseCap=player.health.attributes.incomingCap??Infinity;
  let previousTags:readonly string[]=[];
  const apply=():void=>{
    const effects=[...select(row.player),...select(row.worn,true)];
    if(row.hitCap!==undefined) {const def=definitions.get(row.hitCap);if(def!==undefined)effects.push({def,stacks:1});}
    const max=fold(effects,'maxHealth',baseMax);
    if(player.health.attributes.maxHealth!==max)player.health.setMaxHealth(max);
    player.health.attributes.incomingCap=fold(effects,'incomingCap',baseCap);
    player.health.attributes['dodgeCooldownMul']=fold(effects,'dodgeCooldownMul',1);
    const tags=effects.flatMap(effect=>effect.def.grants??[]);
    player.health.effectTags=[...new Set([...player.health.effectTags.filter(tag=>!previousTags.includes(tag)),...tags])];previousTags=tags;
  };
  apply();host.scope.onDispose(owned.onChange(apply));host.onStep('owned.effects',apply);
  host.events.answer('damage.modify',request=>{
    if(request===null||request.source!==player.health&&!(request.source==='env'&&request.weaponId!==undefined&&weapon(request.weaponId)!==undefined))return request;
    const id=request.weaponId??source.items.loadout.native?.slots[player.held];
    return typeof id!=='string'?request:{...request,amount:read(player,id,'damage',request.amount)};
  },host.scope,{order:30});
}
