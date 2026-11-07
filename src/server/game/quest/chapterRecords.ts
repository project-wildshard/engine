import * as v from 'valibot';
import {SaveStore,type SaveStorage} from '@wildshard/engine/saves/store';
import type {SimHost} from '@wildshard/engine/sim';
import {AdventurePersistenceSchema} from '@wildshard/format/namedJsonContracts';
import type {ShardProduct} from '../../../shared/game/shardfile/shardProduct';
import {installRuntimeState,pageStateOf} from '../../../shared/game/shardfile/runtimeState';
import type {ObservedRecords} from '../../../shared/game/quest/questObservation';
import {featOutcome,witnessSavedFeats} from '../../../shared/game/quest/featCounters';
import {nativeQuestInputs,type NativeQuestInputs} from './nativeInputs';

interface BossRecord { defeated:boolean;rewardTaken:boolean;kills:number }
/** The actual declared boss field and the existing elite continuation, borrowed
 * by chapter observations. Only encounter owners may publish boss outcomes. */
export interface ChapterRecords extends ObservedRecords {
  readonly bosses:ObservedRecords['bosses'] & {
    readonly write:(value:Readonly<Record<string,BossRecord>>)=>boolean;
  };
  readonly outcomes:{readonly kill:(kind:string,variant?:string)=>void;readonly feat:(event:string,total?:number)=>void};
}
export type InstallChapterRecords=(host:SimHost,facts?:Pick<NativeQuestInputs['ledger'],'fact'>)=>ChapterRecords;
/** Whose steps these are: the record step, and the elite owner it reads. */
export interface ChapterRecordIds {readonly step:string;readonly elites:string}

/** Fresh native sessions start from the admitted field default. Checkpoint
 * restore writes that same validated field; it never manufactures a boss,
 * imports a page's global save, or substitutes zero for a missing owner. */
export async function prepareChapterRecords(product:Pick<ShardProduct,'json'|'shardfile'>,ids:ChapterRecordIds):Promise<InstallChapterRecords> {
  const source=product.shardfile,rows=v.parse(AdventurePersistenceSchema,await product.json('quests/persistence.json'));
  const finite=v.pipe(v.number(),v.finite()),number=rows.nonnegative?v.pipe(finite,v.minValue(0)):finite;
  const bosses=v.record(v.string(),v.object({defeated:v.boolean(),rewardTaken:v.boolean(),kills:number}));
  const counts=v.record(v.string(),v.pipe(number,v.integer()));
  const continuation=v.strictObject({version:v.literal(1),bosses,counts});
  const elites=v.object({records:v.record(v.string(),v.object({kills:number}))});
  return (host,facts)=>{
    if(host.scope.disposed||host.scope.disposing||host.hasStep(ids.step))
      throw new Error('Chapter records require their unique live native entry');
    const eliteOwner=host.adapters.get(ids.elites);
    if(eliteOwner===undefined)throw new Error('Chapter records require the installed native elite owner');
    // This native entry owns real storage for its lifetime. The adapter below
    // carries the admitted field into a fresh owner; no page globals or disk
    // saves leak between proofs, and SaveStore's refused-write law is intact.
    const documents=new Map<string,string>();
    const local:SaveStorage={get length(){return documents.size;},key:index=>[...documents.keys()][index]??null,
      getItem:key=>documents.get(key)??null,setItem:(key,value)=>{documents.set(key,value);},
      removeItem:key=>{documents.delete(key);}};
    const saves=new SaveStore({local,session:null});host.scope.onDispose(()=>{documents.clear();});
    const field=installRuntimeState(saves,host.scope,source,source.identity.slug,rows.bosses.key,()=>null);
    const counterRows=rows.counters;
    if(counterRows===undefined)throw new Error('Chapter outcomes require their declared counter field');
    const counterField=installRuntimeState(saves,host.scope,source,source.identity.slug,counterRows.key,()=>null);
    const live=():void=>{
      if(host.scope.disposed||host.scope.disposing||host.adapters.get(ids.elites)!==eliteOwner)
        throw new Error('Chapter record owners retired or changed');
    };
    const read=():Record<string,BossRecord>=>{
      live();const text=field.read();
      if(typeof text!=='string')throw new Error('Chapter boss field must retain its declared JSON wire');
      const input:unknown=JSON.parse(text);return v.parse(bosses,input);
    };
    // Admit the source default before installing a continuation adapter.
    read();
    const write=(value:Readonly<Record<string,BossRecord>>):boolean=>{
      live();const admitted=v.parse(bosses,value),result=field.write(JSON.stringify(admitted));
      if(!result&&rows.refuseWrites)throw new Error('Chapter boss record could not be saved');
      if(result&&rows.bosses.flagPrefix!==undefined)for(const [id,saved]of Object.entries(admitted))
        if(saved.defeated)host.flags.set(rows.bosses.flagPrefix+id);
      return result;
    };
    const readCounts=():Record<string,number>=>{
      live();const text=counterField.read();if(typeof text!=='string')throw new Error('Chapter counts must retain their declared JSON wire');
      const input:unknown=JSON.parse(text);return v.parse(counts,input);
    };
    const writeCounts=(value:Record<string,number>):void=>{
      live();if(!counterField.write(JSON.stringify(v.parse(counts,value)))&&rows.refuseWrites)throw new Error('Chapter counts could not be saved');
    };
    const counterPorts={read:readCounts,write:writeCounts,fact:(fact:string,key:string)=>{
      if(!source.ledger.some(row=>row.fact===fact))throw new Error('Undeclared chapter ledger fact');
      (facts??nativeQuestInputs(host).ledger).fact(fact,key);
    }};
    witnessSavedFeats(counterRows,counterPorts);
    // A world's first boot takes what a page's save held, so a beaten boss and a running count stand as they did. Their facts are the page's, and filed.
    const pageBosses=v.safeParse(bosses,pageStateOf(host,rows.bosses.key)),pageCounts=v.safeParse(counts,pageStateOf(host,counterRows.key));
    if(pageBosses.success)write(pageBosses.output);
    if(pageCounts.success)writeCounts(pageCounts.output);
    const owner:ChapterRecords={bosses:{read,write},elites:{read:()=>{
      live();return v.parse(elites,eliteOwner.snapshot()).records;
    }},outcomes:{kill:(kind,variant)=>{featOutcome(counterRows,counterPorts,'kill',kind,variant);},
      feat:(event,total)=>{featOutcome(counterRows,counterPorts,'event',event,undefined,total);}}};
    host.onStep(ids.step,()=>{/* Encounters own all writes; this adapter adds no tick work. */}, {
      snapshot:()=>JSON.stringify({version:1,bosses:read(),counts:readCounts()}),restore:value=>{
        if(typeof value!=='string')throw new Error('Chapter boss continuation requires its JSON wire');
        const input:unknown=JSON.parse(value),saved=v.parse(continuation,input);write(saved.bosses);writeCounts(saved.counts);
      },
    });
    return owner;
  };
}
