// oxlint-disable-next-line import/no-unassigned-import -- The sim's Math goes in before any module body runs.
import '../../../src/shared/engine/core/portableMathFirst';
import {HeadlessSimulation} from '../../../src/server/host/headless';
import {loadHeadlessFolder} from '../../../src/server/host/headlessFolder';
import {folderHeadlessSections} from '../../../src/shared/host/headlessSections';
import { outputDescriptor } from '../../../src/shared/game/shardfile/outputDescriptor';
import {builtFolder} from '../../../src/test/game/builtFolder';
import {createNativeProofWorker,type NativeProofKind} from '../headless-worker';
import {recordNativeProcessUsage} from '../../../src/test/game/headless/processUsage';
import {admittedFolder} from '../../../src/test/game/headless/admittedFolderCache';

if(['nalati-awareness-run.ts','nalati-discovery-run.ts'].includes(process.argv[1]?.replaceAll('\\','/').split('/').at(-1)??''))recordNativeProcessUsage();

export type FolderSessionVariant = Extract<NativeProofKind, 'driftwood' | 'driftwood-trade' | 'nine-flat' | 'nalati-companions' | 'nalati-weapons' | 'nalati-predators' | 'nalati-world' | 'nalati-stealth' | 'nalati-verbs' | 'nalati-kokpar' | 'nalati-chapter' | 'nalati-king' | 'nalati-qara' | 'nalati-titan' | 'nalati-practice' | 'pine-verbs' | 'sky-verbs'>;
const variantHosts: Readonly<Record<string, string>> = { 'driftwood': 'driftwood-isle', 'driftwood-trade': 'driftwood-isle', 'sky-verbs': 'far-reach', 'pine-verbs': 'pine-hollow', 'nine-flat': 'nine-dragon-stack', 'nalati-companions': 'nalati-grasslands', 'nalati-weapons': 'nalati-grasslands', 'nalati-predators': 'nalati-grasslands', 'nalati-world': 'nalati-grasslands', 'nalati-stealth': 'nalati-grasslands', 'nalati-verbs': 'nalati-grasslands', 'nalati-kokpar': 'nalati-grasslands', 'nalati-chapter': 'nalati-grasslands', 'nalati-king': 'nalati-grasslands', 'nalati-qara': 'nalati-grasslands', 'nalati-titan': 'nalati-grasslands', 'nalati-practice': 'nalati-grasslands' };

type FolderSimulation=Pick<HeadlessSimulation,'verbTape'|'verbTapePart'|'streamVerbTape'|'journey'|'walkLeg'|'step'|'dispose'|'quarantined'|'checkpoint'>;
export type FolderWorkerFactory=(...args:Parameters<typeof HeadlessSimulation.create>)=>Promise<FolderSimulation>;
const defaultFolderWorker:FolderWorkerFactory=(...args)=>HeadlessSimulation.create(...args);

/** Start the independent replay owner while its caller records native input.
 * Readiness still awaits the same worker admission and initial checkpoint. A native worker takes its snapshot as a promise
 * too: it boots while the caller makes the checkpoint (QA 11-25 row 59). */
export async function beginFolderSession(slug:string,variant?:FolderSessionVariant,snapshot?:string|PromiseLike<string>,createWorker:FolderWorkerFactory=defaultFolderWorker):Promise<{ready:()=>Promise<FolderSimulation>;assets:ReadonlyMap<string,Uint8Array>;product:Awaited<ReturnType<typeof loadHeadlessFolder>>}> {
  if(variant!==undefined&&variantHosts[variant]!==slug)throw new Error('Native proof variant does not match product');
  const directory=builtFolder(slug),{product,assets}=await admittedFolder(directory,'full'),source=product.shardfile;
  const descriptor=outputDescriptor(source);if(descriptor===undefined)throw new Error('Missing admitted headless inventory');
  const sections=folderHeadlessSections(product);
  const nativeKinds={'driftwood-isle':'driftwood','pine-hollow':'pine','nine-dragon-stack':'nine','nalati-grasslands':'nalati'} as const;
  // A declared product (no runtime, no sim/runtime-plan; Nine from rev 5) runs on the data host, as its room does; only a
  // client-plan runtime's product takes its fixed native adapter.
  const declared=source.runtime===null&&!sections.has('sim/runtime-plan');
  const nativeKind=variant??(!declared&&!sections.has('sim/runtime-plan')&&(slug==='driftwood-isle'||slug==='pine-hollow'||slug==='nine-dragon-stack'||slug==='nalati-grasslands')?nativeKinds[slug]:undefined);
  const pending=nativeKind===undefined?Promise.resolve(snapshot).then(checkpoint=>createWorker(source,assets,checkpoint,{deadline:'advisory',sections}))
    :createNativeProofWorker(source,assets,nativeKind,snapshot,sections,directory);
  // Observe failure immediately even while the caller is preparing its owner.
  const outcome=(async()=>{try{return {ok:true as const,sim:await pending};}catch(error){return {ok:false as const,error};}})();
  return {product,assets,ready:async()=>{const result=await outcome;if(!result.ok)throw result.error;return result.sim;}};
}

/** The same checked products and fixed native adapters as the main integration journey. */
export async function openFolderSession(slug:string,variant?:FolderSessionVariant,snapshot?:string):Promise<{sim:FolderSimulation;product:Awaited<ReturnType<typeof loadHeadlessFolder>>}> {
  const session=await beginFolderSession(slug,variant,snapshot);
  return {sim:await session.ready(),product:session.product};
}
