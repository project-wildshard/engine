import * as v from 'valibot';
import { saves } from '@wildshard/engine/saves/runtime';
import type { SaveSlot } from '@wildshard/engine/saves/store';

const names: v.RecordSchema<v.StringSchema<undefined>, v.StringSchema<undefined>, undefined>=v.record(v.string(),v.string()),cosmetics: v.ObjectSchema<{ readonly owned: v.ArraySchema<v.StringSchema<undefined>, undefined>; readonly worn: v.RecordSchema<v.StringSchema<undefined>, v.StringSchema<undefined>, undefined>; }, undefined>=v.object({owned:v.array(v.string()),worn:names});
const nameSlots=new Map<string,SaveSlot<v.InferOutput<typeof names>>>(),cosmeticSlots=new Map<string,SaveSlot<v.InferOutput<typeof cosmetics>>>(),bondSlots=new Map<string,SaveSlot<string|null>>();
/** Native migration authorities are selected by declared save ids. Definitions
 * are lazy and shared; content never supplies a schema, initializer or reader. */
export function legacyAdventureNames(key:string):SaveSlot<v.InferOutput<typeof names>>{
  let slot=nameSlots.get(key);if(slot===undefined){slot=saves.define({key,scope:'shard',version:1,schema:names,initial:()=>({})});nameSlots.set(key,slot);}return slot;
}
export function legacyAdventureCosmetics(key:string):SaveSlot<v.InferOutput<typeof cosmetics>>{
  let slot=cosmeticSlots.get(key);if(slot===undefined){slot=saves.define({key,scope:'shard',version:1,schema:cosmetics,initial:()=>({owned:[],worn:{}})});cosmeticSlots.set(key,slot);}return slot;
}
export function legacyAdventureBond(key:string):SaveSlot<string|null>{
  let slot=bondSlots.get(key);if(slot===undefined){slot=saves.define({key,scope:'shard',version:1,schema:v.nullable(v.string()),initial:()=>null});bondSlots.set(key,slot);}return slot;
}
