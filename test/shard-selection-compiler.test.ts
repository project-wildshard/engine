import {expect,test} from 'vitest';
import {catalogueManifests,titleManifests,titleMetadata,installTitleManifests} from '../src/client/game/shard/titleList';
import {shards,installShards} from '../src/client/game/shard/list';
import {saveCards} from '../src/client/game/savesSettings';
import { installCatalogueFixture } from './fixtures/bootSetup';

await installCatalogueFixture();

test('selected manifests override scalar cards while every save and pack policy stays available',()=>{
 const prepared=shards(),previous=titleManifests(),metadata=prepared.map(titleMetadata),selected=prepared[0];
 if(selected===undefined)throw new Error('Missing generated discovery');
 try{
  installTitleManifests(metadata);installShards([selected]);
  const catalogue=catalogueManifests();
  expect(catalogue.find(row=>row.slug===selected.slug)).toBe(selected);
  expect(catalogue.map(row=>row.slug)).toEqual(prepared.map(row=>row.slug));
  for(const developer of [false,true])expect(saveCards(catalogue,developer)).toEqual(saveCards(prepared,developer));
  for(const row of prepared){const card=catalogue.find(candidate=>candidate.slug===row.slug);expect(card?.bag).toEqual(row.bag);}
 }finally{installShards(prepared);installTitleManifests(previous);}
});
