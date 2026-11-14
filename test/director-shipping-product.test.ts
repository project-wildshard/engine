import {expect,test} from 'vitest';
import {Scope} from '../src/shared/engine/app/scope';
import {readDirectorDocument} from '../src/shared/game/plugin/director';
import {loadHeadlessFolder} from '../src/server/host/headlessFolder';
import {builtFolder} from './fixtures/builtFolder';
import {pineDirector,driftwoodDirector} from './fixtures/director-modules';

for(const [slug,module] of [['pine-hollow',pineDirector],['driftwood-isle',driftwoodDirector]] as const){
  test(`${slug} ships one raw director and admits its original native factory`,async()=>{
    const product=await loadHeadlessFolder(builtFolder(slug)),scope=new Scope('shipping.director');
    try{
      expect(await product.json<unknown>('directors/main.json')).toMatchObject({module:{module:module.module,bytes:'',file:'behaviour/director.wasm'}});
      const director=await readDirectorDocument(product,scope);
      expect(director.bytes).toEqual(module.bytes);
      expect(()=>director.create()).not.toThrow();
    }finally{scope.dispose();}
  });
}
