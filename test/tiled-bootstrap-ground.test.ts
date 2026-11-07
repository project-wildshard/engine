import { expect, test } from 'vitest';
import * as v from 'valibot';
import { PropsSchema } from '@wildshard/format/props';
import { tiledBootstrapGround } from '../src/shared/game/shardfile/clientGround';
import type { ShardManifest } from '../src/client/game/shard/manifest';

const hashes = (digit: string): string[] => Array.from({length:4},()=>digit.repeat(64));
const props = v.parse(PropsSchema, { version:1,family:'pbr',tiles:[{lod:0,x:0,z:0,file:'a'.repeat(64)}],panels:[],models:[],far:null,textures:[],colliders:[],
  splat:{material:'ground',layers:{colour:hashes('1'),normal:hashes('2'),arm:hashes('3')},tints:Array.from({length:4},()=>[1,1,1]),boreal:null} });
const ground: ShardManifest['ground'] = { structures:true,paths:'plugin' };

test('tile-owned bootstrap preserves the original ground and marks only its draw ownership', () => {
  const result = tiledBootstrapGround(ground,props,['terrain','props']);
  expect(result).toEqual({...ground,tiled:true}); expect(result).not.toBe(ground);
  expect(ground.tiled).toBeUndefined();
  expect(tiledBootstrapGround(result,props,['terrain','props'])).toBe(result);
});

test('unbound, absent or empty tile sources retain their complete native bootstrap', () => {
  for (const binds of [[],['terrain'],['props']]) expect(tiledBootstrapGround(ground,props,binds)).toBe(ground);
  expect(tiledBootstrapGround(ground,null,['terrain','props'])).toBe(ground);
  expect(tiledBootstrapGround(ground,{...props,tiles:[]},['terrain','props'])).toBe(ground);
  const {splat:_splat,...ordinary}=props;
  expect(tiledBootstrapGround(ground,ordinary,['terrain','props'])).toBe(ground);
});
