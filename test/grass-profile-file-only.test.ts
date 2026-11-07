import {expect,test,vi} from 'vitest';
import {DataTexture} from 'three';
import {GrassPresentationProfile} from '../src/client/game/looks/grassPresentation';
import {GRASS_FILES,originalGrassProfile} from './fixtures/nalatiGrass';

const original=originalGrassProfile().rows;
const inline='eJxjYGBgAAAABAAB';
const payloads=['height','mask','field','ground']as const;
for(const key of payloads)test(`grass refuses inline ${key} before file access`,()=>{
  const files=new Map(GRASS_FILES),has=vi.spyOn(files,'has'),get=vi.spyOn(files,'get');
  expect(()=>new GrassPresentationProfile({...original,[key]:inline},files)).toThrow('Grass requires binary files');
  expect(has).not.toHaveBeenCalled();expect(get).not.toHaveBeenCalled();
});
for(const tier of ['phone','desktop']as const)for(const key of ['blades','flowers','cards']as const)
  test(`grass refuses inline ${tier} ${key} before file access`,()=>{
    const rows=structuredClone(original),files=new Map(GRASS_FILES),has=vi.spyOn(files,'has'),get=vi.spyOn(files,'get');
    rows[tier].scenes[key]=inline;
    expect(()=>new GrassPresentationProfile(rows,files)).toThrow('Grass requires binary files');
    expect(has).not.toHaveBeenCalled();expect(get).not.toHaveBeenCalled();
  });
test('prepared profiles cannot decode later inline payload arguments',()=>{
  const profile=new GrassPresentationProfile(original,GRASS_FILES);
  expect(()=>profile.bytes(inline)).toThrow('Grass requires binary files');
  expect(()=>profile.scene(inline)).toThrow('Grass requires binary files');
  // No texture is retained when either invalid public intake refuses.
  const texture=profile.heightTexture();expect(texture).toBeInstanceOf(DataTexture);texture.dispose();
});
