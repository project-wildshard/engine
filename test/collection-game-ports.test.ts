// @vitest-environment happy-dom
import {expect,test} from 'vitest';
import type {PerspectiveCamera,Scene} from 'three';
import type {Renderer} from '../src/client/engine/render/renderer';
import {FakeGame} from '../src/test/engine/FakeGame';
import {LightPool} from '../src/client/engine/fx/LightPool';
import {collectionGamePorts} from '../src/client/game/compendium/keepsakes';

test('a collection borrows inherited scene/camera/renderer ports for its real pickup light pool',()=>{
  const fake=new FakeGame(),source=fake.asGame();
  class BorrowedGame {
    get scene():Scene{return source.scene;}
    get camera():PerspectiveCamera{return source.camera;}
    get renderer():Renderer{return source.renderer;}
  }
  const world=new BorrowedGame();
  expect(Object.hasOwn(world,'scene')).toBe(false);
  let scheduled:((dt:number,t:number)=>void)|undefined;
  const game=collectionGamePorts(world,run=>{scheduled=run;});
  try {
    const pool=LightPool.for(game.scene);
    expect(pool.group.parent).toBe(source.scene);
    expect(game.scene).toBe(source.scene);expect(game.camera).toBe(source.camera);expect(game.renderer).toBe(source.renderer);
    const update=():void=>undefined;game.onUpdate(update);expect(scheduled).toBe(update);
  }finally{fake.playerScope.dispose();}
});
