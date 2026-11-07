import { TIER } from '@wildshard/engine/core/tier';
import { readDiscovery } from '@wildshard/engine/game/shard/discovery';
import { installShards } from '@wildshard/engine/game/shard/list';
import { game } from '@wildshard/engine/game/shard/registry';
import { titleManifests,findTitleManifest,type TitleManifest } from '@wildshard/engine/game/shard/titleList';
import type { PageMode } from '@wildshard/engine/game/grid/pageMode';
import { selectedManifests, gridManifests, type SelectedManifests } from './selectedManifests';

/** C3: a title row's loader reads its product's discovery; a row with none (a catalogue shard from before J86) has no loader. */
const hasDiscovery=(row:TitleManifest|undefined):row is TitleManifest=>row?.discovery!==undefined;
const loaders=()=>Object.fromEntries(titleManifests().filter(hasDiscovery).map(row=>[row.slug,()=>readDiscovery(row)]));

/** A grid may synchronously read every primary neighbour after consuming its intent, and desktop keeps every shard for its
 * background prefetch. Frozen standalone copies remain available through their own loaders. */
export function preparePageCatalogue():Promise<SelectedManifests>{
  return gridManifests(titleManifests().filter(hasDiscovery),loaders());
}

export async function completeCatalogue():Promise<void>{
  installShards((await preparePageCatalogue()).manifests);
  // the running shard resolves now, as it did when the registry built it at import: the level is configured early
  void game.shard;
}

/** Phones prepare their original selected manifest, never every world's data.
 * Desktop background prefetch retains full discovery; frozen phone entries prepare
 * only their inventoried primary pair, preserving content and save namespaces. */
export async function prepareSelectedShard():Promise<void>{
  const rows=titleManifests(),named=new URLSearchParams(location.search).get('chunk');
  // C3: a catalogue shard with no discovery enters on the first row's page; its product replaces it in admission.
  const row=named===null?undefined:findTitleManifest(named),selected=hasDiscovery(row)?row:rows.find(hasDiscovery);
  if(selected===undefined)throw new Error('No shard has a discovery document');
  if(TIER!=='phone'){await completeCatalogue();return;}
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
