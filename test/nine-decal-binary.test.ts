import {expect,test} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Compare retained native pixels without embedding any binary in JSON.
import {createHash} from 'node:crypto';
import {output} from './fixtures/nine-source-program';
import {readImagePixels} from '../src/sharddev/bake/image';
import before from './fixtures/nine-decal-binary.json' with {type:'json'};

for(const tier of ['phone','desktop'] as const)test(`${tier} decal uses the original PNG, costs and native pixels through declared file intake`,async()=>{
  const file=output.namedFiles?.find(row=>row.name===`looks/jian-decal-${tier}.png`);
  const bytes=file?output.assets?.get(file.hash):undefined;
  if(!file||!bytes)throw new Error(`Missing owned ${tier} decal`);
  const image=await readImagePixels(bytes);
  expect(file).toStrictEqual(before[tier].file);
  expect(image.width).toBe(before[tier].width);expect(image.height).toBe(before[tier].height);
  expect(createHash('sha256').update(image.pixels).digest('hex')).toBe(before[tier].pixelHash);
});
