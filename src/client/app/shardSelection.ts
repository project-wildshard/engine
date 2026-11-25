import { exploreChannel } from '@wildshard/engine/app/view/exploreChannel';
import { TIER } from '@wildshard/engine/core/tier';
import { readDiscovery } from '@wildshard/engine/game/shard/discovery';
import { installShards } from '@wildshard/engine/game/shard/list';
import { game, setPageZone } from '@wildshard/engine/game/shard/registry';
import { titleManifests,findTitleManifest,type TitleManifest } from '@wildshard/engine/game/shard/titleList';
import type { PageMode } from '@wildshard/engine/game/grid/pageMode';
import { selectedManifests, gridManifests, type SelectedManifests } from './selectedManifests';

/** C3: a title row's loader reads its product's discovery; a row with none (a catalogue shard from before J86) has no loader. */
const hasDiscovery=(row:TitleManifest|undefined):row is TitleManifest=>row?.discovery!==undefined;
// SB28: the boot path's reads wait on the loading card's RETRY when the network drops; the title's Settings (no card) passes false
const loaders=(wait=true)=>Object.fromEntries(titleManifests().filter(hasDiscovery).map(row=>[row.slug,()=>readDiscovery(row,fetch,{wait})]));

/** A grid may synchronously read every primary neighbour after consuming its intent, and desktop keeps every shard for its
 * background prefetch. Frozen standalone copies remain available through their own loaders. */
export function preparePageCatalogue(wait=true):Promise<SelectedManifests>{
  return gridManifests(titleManifests().filter(hasDiscovery),loaders(wait));
}

export async function completeCatalogue(wait=true):Promise<void>{
  installShards((await preparePageCatalogue(wait)).manifests);
  // the running shard resolves now, as it did when the registry built it at import: the level is configured early
  void game.shard;
}

/** Phones prepare their original selected manifest, never every world's data.
 * Desktop background prefetch retains full discovery; frozen phone entries prepare
 * only their inventoried primary pair, preserving content and save namespaces. Explore always opens just one shard. */
export async function prepareSelectedShard(named: string | null = new URLSearchParams(location.search).get('chunk')):Promise<void>{
  setPageZone(named); // CP1: the running manifest resolves at the zone the entry picked (a tap's, on a bare address)
  const rows=titleManifests();
  // C3: a catalogue shard with no discovery enters on the first row's page; its product replaces it in admission.
  const row=named===null?undefined:findTitleManifest(named);
  if(named!==null&&row===undefined&&document.getElementById('ws-shardfile')===null)throw new Error('The requested world is not listed');
  const selected=hasDiscovery(row)?row:rows.find(hasDiscovery);
  if(selected===undefined)throw new Error('No shard has a discovery document');
  if(TIER!=='phone'&&!exploreChannel()){await completeCatalogue();return;}
  const prepared=await selectedManifests(selected,loaders());
  installShards(prepared.manifests);
}

/** Only the original publication barrier installs a prepared catalogue. */
export async function completePageCatalogue(mode:PageMode, prepared:()=>Promise<SelectedManifests>=preparePageCatalogue):Promise<void>{
  if(mode==='grid'){
    const catalogue=await prepared();
    installShards(catalogue.manifests);
  }
}
