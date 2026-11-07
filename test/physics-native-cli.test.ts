import {expect,test} from 'vitest';
import {assertNativeWalkResult,nativeWalkSelection,nativeWalkTestFiles,runNativePhysicsWalk} from '../scripts/physics-native.mjs';

test('native route selection preserves explicit leg repetitions and refuses no work',()=>{
  const routes={$doc:'metadata',first:[{name:'bridge'},{name:'stairs'}],second:[{name:'bridge'}]};
  expect(nativeWalkSelection(routes,[]).count).toBe(3);
  expect(nativeWalkSelection(routes,['--shard=first','--leg=bridge','--repeat=3']).count).toBe(3);
  expect(nativeWalkSelection(routes,['--leg=bridge']).count).toBe(2);
  expect(()=>nativeWalkSelection(routes,['--shard=missing'])).toThrow('No native physics route');
  expect(()=>nativeWalkSelection(routes,['--leg=missing'])).toThrow('No native physics route');
  expect(()=>nativeWalkSelection(routes,['--repeat=0'])).toThrow('--repeat');
  expect(()=>nativeWalkSelection(routes,['--repeat=11'])).toThrow('--repeat');
});
test('a zero-exit partial or failed collection cannot report a zero-stuck walk',()=>{
  expect(()=>assertNativeWalkResult({success:true,numPassedTests:0,numFailedTests:0},3)).toThrow('Incomplete native physics proof');
  expect(()=>assertNativeWalkResult({success:true,numPassedTests:2,numFailedTests:0},3)).toThrow('Incomplete native physics proof');
  expect(()=>assertNativeWalkResult({success:false,numPassedTests:3,numFailedTests:1},3)).toThrow('Incomplete native physics proof');
  expect(()=>assertNativeWalkResult({success:true,numPassedTests:3,numFailedTests:0},3)).not.toThrow();
});
test('route names are literal selections rather than test-name regular expressions',()=>{
  const routes={first:[{name:'stairs.[a]+'},{name:'stairsXaaa'}],second:[{name:'stairsXaaa'}]};
  const selected=nativeWalkSelection(routes,['--leg=stairs.[a]+']);
  expect(selected.count).toBe(1);expect(selected.slugs).toEqual(['first']);
});
test('a native proof cannot silently claim a remote preview or browser variant',()=>{
  expect(()=>runNativePhysicsWalk('.', ['--url=http://127.0.0.1:4400'])).toThrow('not a browser preview');
  expect(()=>runNativePhysicsWalk('.', ['--video'])).toThrow('has no video');
  expect(()=>runNativePhysicsWalk('.', ['--settings=gravity=low'])).toThrow('Browser variants');
  expect(()=>runNativePhysicsWalk('.', ['--tier=desktop'])).toThrow('Browser variants');
});

test('CLI route selections use each complete resident module once after the physics split',()=>{
  const others=['pine-hollow','nine-dragon-stack','sunscar-dunes','far-reach','blender-template'];
  expect(nativeWalkTestFiles(['nalati-grasslands'])).toEqual(['test/physics-nalati-headless.test.ts']);
  expect(nativeWalkTestFiles(others)).toEqual(['test/physics-shards-headless.test.ts']);
  expect(nativeWalkTestFiles(['driftwood-isle','nalati-grasslands',...others])).toEqual([
    'test/physics-headless.test.ts','test/physics-nalati-headless.test.ts','test/physics-shards-headless.test.ts',
  ]);
  expect(nativeWalkTestFiles(['nalati-grasslands','nalati-grasslands',...others,...others])).toHaveLength(2);
});

test('open plots select their own admitted resident suite',()=>{
  expect(nativeWalkTestFiles(['open-plot-frostline-peaks','open-plot-coral-drift'])).toEqual(['test/physics-open-plots-headless.test.ts']);
});
