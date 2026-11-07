// oxlint-disable-next-line import/no-nodejs-modules -- Compare isolated native construction without selecting a world in this test process.
import { execFileSync } from 'node:child_process';
import { expect, test } from 'vitest';

const setup = `
  import assert from 'node:assert/strict';
  import { createHash } from 'node:crypto';
  import { placeForest,placeForestSteps } from './src/shared/engine/world/forest/placement.ts';
  import { selectedLevel,configureLevel } from './src/shared/engine/level/selection.ts';
  import { _applyChunkConstants,SEED,TREE_COUNT } from './src/shared/engine/core/config.ts';
  import { buildTerrain } from './src/shared/engine/world/terrainField.ts';
  const forest={spacing:13,densityFreq:.03,clearings:[-.7,.2],maxSlope:.8,tintHue:.25,tintHueJitter:[-.01,.02],tintSat:[.4,.7],tintLight:[.5,.8],largeVariantChance:.2};
  const terrain=buildTerrain(77,{landscape:()=>0,trails:[],cabinSites:[]});
  const source={...terrain,seed:77,treeCount:12,forest};
  const variants=Array.from({length:4},(_,i)=>({trunkRadius:.2+i*.1,height:5+i}));
  const hash=trees=>createHash('sha256').update(JSON.stringify(trees.map(({tint,...row})=>({...row,tint:tint.toArray()})))).digest('hex');
  const original='ca044bd632b69c514ac3d196089bacd0aff47b66f0aa5011291d1bf7fca13e92';
`;

function run(body: string): string {
  return execFileSync(process.execPath, ['--experimental-transform-types', '--import', './scripts/bake-loader.mjs',
    '--input-type=module', '--eval', setup + body], { encoding: 'utf8' });
}

test('explicit forest construction matches the independent predecessor without a selected level', () => {
  expect(run(`
    assert.equal(selectedLevel(),null);const constants=[SEED,TREE_COUNT];
    const before=JSON.stringify(source.forest),made=placeForest(variants,source);
    assert.equal(made.trees.length,12);assert.equal(hash(made.trees),original);
    assert.equal(selectedLevel(),null);assert.deepEqual([SEED,TREE_COUNT],constants);
    assert.equal(JSON.stringify(source.forest),before);
    const steps=placeForestSteps(variants,source);let row=steps.next();while(!row.done)row=steps.next();
    assert.equal(hash(row.value.trees),original);
    const tree=made.trees[0];assert.ok(made.grid.nearby(tree.x,tree.z).includes(tree));
    tree.tint.setRGB(0,0,0);tree.x+=1;
    assert.equal(hash(placeForest(variants,source).trees),original);
    assert.equal(placeForest(variants,{...source,treeCount:0}).trees.length,0);
    const {forest:unused,...none}=source;
    assert.equal(placeForest(variants,none).trees.length,0);
    console.log('explicit forest predecessor PASS');
  `)).toContain('explicit forest predecessor PASS');
});

test('the page default retains its complete predecessor tree records', () => {
  expect(run(`
    configureLevel({ground:{terrain},forest});
    _applyChunkConstants({slug:'fixture',label:'fixture',seed:77,treeCount:12});
    assert.equal(hash(placeForest(variants).trees),original);
    const steps=placeForestSteps(variants);let row=steps.next();while(!row.done)row=steps.next();
    assert.equal(hash(row.value.trees),original);
    console.log('page forest predecessor PASS');
  `)).toContain('page forest predecessor PASS');
});

test('explicit and page inputs preserve predecessor infill, species and zero-seed streams', () => {
  expect(run(`
    for(const [name,seed,treeCount,policy,specs,expected] of [
      ['infill',123,99,{...forest,spacing:21,infill:{x:0,z:0,r:40},density:x=>x>0?.8:.2,mask:(_x,z)=>z>0?.9:.3},variants,
        'ce977d75c034c1d424a79920e85f81f84560d13d45e7e17d65cbdef2ecd55cb4'],
      ['species',52,64,{...forest,species:()=>({a:1,b:2}),speciesTraits:[{id:'a',scale:[.8,1.2],girth:.1,spacing:'wide',grows:false},
        {id:'b',scale:[.6,1.1],girth:.05,spacing:'tight',grows:true}],scale:x=>x>0?1.1:.9},variants.map((row,i)=>({...row,species:i%2===0?'a':'b'})),
        'a308f610482f3738fda33cc7bd526e01795711b2de709625cfc53225fbb3d714'],
      ['seed0',0,20,forest,variants,'982345afe9f76bf539aa667496088f1274f370cab9319c24cc13c2266104904b'],
    ]) {
      configureLevel({ground:{terrain},forest:policy});_applyChunkConstants({slug:'fixture',label:'fixture',seed,treeCount});
      const explicit={...terrain,seed,treeCount,forest:policy};
      for(const result of [placeForest(specs),placeForest(specs,explicit)]) {
        assert.equal(result.trees.length,treeCount,name);assert.equal(hash(result.trees),expected,name);
      }
    }
    console.log('forest branch predecessors PASS');
  `)).toContain('forest branch predecessors PASS');
});

test('sliced page placement retains live field updates while explicit inputs stay independent', () => {
  expect(run(`
    const {captureHeightfield}=await import('./src/shared/engine/world/Heightfield.ts');
    const policy={...forest,spacing:5},count=1000;
    configureLevel({ground:{terrain},forest:policy});_applyChunkConstants({slug:'fixture',label:'fixture',seed:77,treeCount:count});
    const binding=captureHeightfield();
    const steps=placeForestSteps(variants);let row=steps.next();assert.equal(row.done,false);
    binding.install({...terrain,heightAt:()=>20});
    while(!row.done)row=steps.next();
    assert.ok(row.value.trees.some(tree=>tree.y===-.25));assert.ok(row.value.trees.some(tree=>tree.y===19.75));
    const own=placeForestSteps(variants,{...source,forest:policy,treeCount:count});row=own.next();assert.equal(row.done,false);
    binding.install({...terrain,heightAt:()=>40});while(!row.done)row=own.next();
    assert.ok(row.value.trees.length>0);assert.ok(row.value.trees.every(tree=>tree.y===-.25));
    console.log('sliced field independence PASS');
  `)).toContain('sliced field independence PASS');
});
