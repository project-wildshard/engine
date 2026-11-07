import {expect,test} from 'vitest';
import {ScriptWorld} from '../src/shared/engine/script/effects';
import {DeclaredScriptWorld,type ScriptStateDeclaration} from '../src/shared/engine/script/state';

const entity={id:1,name:'actor',position:[0,0,0] as const,fields:{},frozen:false,interactive:true};
const rules={fields:{},archetypes:[],events:[],maxEntities:1};

test('empty effect commits still invalidate an earlier prepared transaction',()=>{
  const world=new ScriptWorld(rules,[entity]);
  const earlier=world.prepare([],1,0,0),later=world.prepare([],1,0,0);
  later.commit();expect(()=>earlier.commit()).toThrow('Stale effect transaction');
  expect(world.callable(1)).toBe(true);world.freeze(1,true);expect(world.callable(1)).toBe(false);
});

test('declared copy-on-write preserves privacy, detached views and atomic suffix refusal',()=>{
  const field={id:1,name:'score',type:'i32',privacy:'public',default:0,min:0,max:10} as const;
  const declaration:ScriptStateDeclaration={shared:[field],player:[{...field,privacy:'owner'}]};
  const world=new DeclaredScriptWorld(rules,[entity],declaration,new Map([[1,'owner']]));
  const before=world.checkpoint(),view=world.view('owner');
  Reflect.set(view.shared,'score',9);expect(world.view('owner').shared['score']).toBe(0);
  expect(()=>world.prepare([{op:5,a:1,b:4,c:0,d:0},{op:6,a:1,b:99,c:0,d:0}],1,0,0)).toThrow();
  expect(world.checkpoint()).toEqual(before);
  const pending=world.prepare([{op:5,a:1,b:4,c:0,d:0},{op:6,a:1,b:3,c:0,d:0}],1,0,0);
  expect(world.view('owner')).toEqual({shared:{score:0},player:{score:0}});pending.commit();
  expect(world.view('owner')).toEqual({shared:{score:4},player:{score:3}});
  world.restoreState(before);expect(world.view('owner')).toEqual({shared:{score:0},player:{score:0}});
});
