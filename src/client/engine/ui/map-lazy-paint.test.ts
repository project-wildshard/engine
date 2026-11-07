// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest';
import { Scope } from '../../../shared/engine/app/scope';
import { withOwner } from '../../../shared/engine/app/ownership';
import { legacyDouble } from '../../../test/engine/FakeGame';
import { FullMap, type MapPoi } from './Map';
import type { Minimap } from './Minimap';

afterEach(() => { vi.restoreAllMocks(); });

function fixture() {
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((frame: FrameRequestCallback) => { frames.push(frame); return frames.length; });
  vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => undefined);
  const fillText = vi.fn<CanvasRenderingContext2D['fillText']>();
  const drawImage = vi.fn<(image: CanvasImageSource, ...coordinates: number[]) => void>();
  const ctx = legacyDouble<CanvasRenderingContext2D>({
    setTransform: () => undefined, clearRect: () => undefined, fillRect: () => undefined,
    drawImage, strokeRect: () => undefined, strokeText: () => undefined, fillText,
    measureText: text => legacyDouble<TextMetrics>({ width: text.length * 7 }),
    beginPath: () => undefined, moveTo: () => undefined, lineTo: () => undefined,
    closePath: () => undefined, save: () => undefined, restore: () => undefined,
    translate: () => undefined, rotate: () => undefined, fill: () => undefined,
    stroke: () => undefined, arc: () => undefined, setLineDash: () => undefined,
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function canvasContext(this: HTMLCanvasElement) { return Object.assign(ctx, {canvas:this}); });
  const image = document.createElement('canvas');
  const minimap = legacyDouble<Minimap>({room:null,bakedGround:true,marks:[],layerGen:0,layers:{terrain:image,cover:image}});
  const scope = new Scope('lazy-map'), map = withOwner(scope, () => new FullMap(minimap));
  map.mount(document.body);
  return {map,scope,frames,fillText,drawImage};
}

test('first open paints without an import wait and keeps changed POIs live',()=>{
  const {map,scope,frames,fillText,drawImage}=fixture();
  let pois:MapPoi[]=[{x:0,z:0,label:'BEFORE',kind:'place'}];
  try{
    map.setPois(()=>pois);map.update({x:12,z:14},0);
    expect(drawImage).not.toHaveBeenCalled();
    map.show();pois=[{x:0,z:0,label:'LATEST',kind:'place'}];
    expect(document.querySelector('.ws-progress')).toBeNull();
    for(const frame of frames.splice(0))frame(16);
    expect(drawImage).toHaveBeenCalled();
    expect(fillText.mock.calls.some(([text])=>text==='LATEST')).toBe(true);
    expect(fillText.mock.calls.some(([text])=>text==='BEFORE')).toBe(false);
    pois=[{x:1,z:1,label:'NEXT',kind:'place'}];
    for(const frame of frames.splice(0))frame(32);
    expect(fillText.mock.calls.some(([text])=>text==='NEXT')).toBe(true);
  }finally{scope.dispose();}
});

test('closing before the first frame prevents a late draw',()=>{
  const {map,scope,frames,drawImage}=fixture();
  try{
    map.setPois(()=>[]);map.show();map.hide();
    expect(document.querySelector('.ws-progress')).toBeNull();
    for(const frame of frames.splice(0))frame(16);
    expect(drawImage).not.toHaveBeenCalled();expect(map.isOpen).toBe(false);
  }finally{scope.dispose();}
});


test('a second open is ready synchronously without progress',()=>{
  const {map,scope}=fixture();
  try{
    map.setPois(()=>[]);map.show();map.hide();map.show();
    expect(document.querySelector('.ws-progress')).toBeNull();
    expect(map.isOpen).toBe(true);
  }finally{scope.dispose();}
});
