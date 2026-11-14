// oxlint-disable-next-line import/no-nodejs-modules -- Startup reads the exact admitted shard product.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { HeadlessSimulation } from '../src/server/host/headless';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { builtFolder } from './fixtures/builtFolder';
import { folderHeadlessSections } from '../src/shared/host/headlessSections';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { decodeSimSnapshot, leadSnapshot } from '../src/shared/engine/sim/snapshot';

test('Nalati boots its admitted native assembly to the first frame',async()=>{
  const directory=builtFolder('nalati-grasslands'),product=await loadHeadlessFolder(directory),descriptor=outputDescriptor(product.shardfile);
  if(descriptor===undefined)throw new Error('Missing startup inventory');
  const assets=new Map(descriptor.index.files.map(file=>[file.commons===true?`commons:${file.hash}`:file.hash,Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const simulation=await HeadlessSimulation.create(product.shardfile,assets,undefined,{deadline:'advisory',sections:folderHeadlessSections(product)});
  try{
    const first=decodeSimSnapshot((await simulation.step()).snapshot);
    expect(first.state.tick).toBeGreaterThan(0);expect(leadSnapshot(first).position.every(Number.isFinite)).toBe(true);expect(simulation.quarantined).toBe(false);
  }finally{await simulation.dispose();}
},120_000);
