// @vitest-environment happy-dom
import {expect,test,vi} from 'vitest';
import type {Game} from '../src/client/engine/core/Game';
import type {WebGLInfo} from 'three';
import {FakeGame,legacyDouble} from '../src/test/engine/FakeGame';
import {Impacts} from '../src/client/engine/fx/Impacts';
import {PerfHud} from '../src/client/engine/ui/perfHud';

test('an open perf HUD reads zero without installing an impact system',()=>{
  const fake=new FakeGame();
  const onUpdate=vi.fn(()=>{throw new Error('Duplicate system id: world.impacts');});
  const game=legacyDouble<Game>({scene:fake.scene,onUpdate,lastFrame:{calls:0,triangles:0},
    renderer:legacyDouble<Game['renderer']>({info:legacyDouble<WebGLInfo>({memory:{geometries:0,textures:0},programs:[]})})});
  const hud=new PerfHud(game,document.createElement('div'),document.createElement('canvas'),[]);
  hud.addCounts(()=>({'fx chips':Impacts.count(game)}));
  const children=[...fake.scene.children];
  try{
    hud.setOpen(true);
    expect(hud.counts()['fx chips']).toBe(0);
    expect(hud.counts()['fx chips']).toBe(0);
    expect(onUpdate).not.toHaveBeenCalled();
    expect(fake.scene.children).toEqual(children);
  }finally{hud.scope.dispose();fake.playerScope.dispose();}
});

test('the read-only count reflects an existing pool without registering again',()=>{
  const fake=new FakeGame(),game=fake.asGame(),onUpdate=vi.spyOn(game,'onUpdate');
  const impacts=Impacts.for(game);
  try{
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate.mock.calls[0]?.[1]).toBe('world.impacts');
    expect(Impacts.count(game)).toBe(0);
    impacts.mesh.count=7;
    expect(Impacts.count(game)).toBe(7);
    expect(Impacts.count(fake.asGame())).toBe(0);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  }finally{impacts.mesh.removeFromParent();impacts.mesh.geometry.dispose();for(const material of Array.isArray(impacts.mesh.material)?impacts.mesh.material:[impacts.mesh.material])material.dispose();fake.playerScope.dispose();}
});
