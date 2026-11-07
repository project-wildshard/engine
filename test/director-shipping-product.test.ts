import {expect,test} from 'vitest';
import {Scope} from '../src/shared/engine/app/scope';
import {readDirectorProduct} from '../src/shared/game/plugin/director';
import {loadHeadlessProduct} from '../src/server/host/headlessProduct';
import {builtProduct} from './fixtures/builtProduct';
import {pineDirector,driftwoodDirector} from './fixtures/director-modules';

for(const [slug,module] of [['pine-hollow',pineDirector],['driftwood-isle',driftwoodDirector]] as const){
  test(`${slug} ships one raw director and admits its original native factory`,async()=>{
    const product=await loadHeadlessProduct(builtProduct(slug)),scope=new Scope('shipping.director');
    try{
      expect(await product.json<unknown>('directors/main.json')).toMatchObject({module:{module:module.module,bytes:'',file:'behaviour/director.wasm'}});
      const director=await readDirectorProduct(product,scope);
      expect(director.bytes).toEqual(module.bytes);
      expect(()=>director.create()).not.toThrow();
    }finally{scope.dispose();}
  });
}
