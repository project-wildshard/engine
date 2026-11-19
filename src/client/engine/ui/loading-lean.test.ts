// @vitest-environment happy-dom
// meta IPHONE13-REAL-TEST IP33: the lean card paints the clock and the facts together at 4 Hz, with no animation frames.
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {LEAN_CARD_DEFAULT,LEAN_CARD_SLOT,Loading,leanLoadingCard,resetLeanLoadingCard} from './Loading';
import {initializeTier,TIER} from '../core/tier';
import {jsonSlot} from '../saves/slots';
import {saveGraphicsMode} from '../core/graphicsMode';

const tier=TIER,slot=jsonSlot(LEAN_CARD_SLOT,'device');
beforeEach(()=>{
  vi.useFakeTimers();vi.setSystemTime(0);
  vi.spyOn(performance,'now').mockImplementation(()=>Date.now());
  resetLeanLoadingCard();
});
afterEach(()=>{slot.reset();jsonSlot('graphics','device').reset();resetLeanLoadingCard();initializeTier(tier);vi.useRealTimers();vi.unstubAllGlobals();document.body.replaceChildren();});

test('a lean card ticks its clock at 4 Hz without an animation-frame chain',()=>{
  slot.write(true);
  const frames=vi.spyOn(globalThis,'requestAnimationFrame'),loading=new Loading({id:'lean-clock',name:'Lean clock'},{scoped:true});
  const clock=loading.root.querySelector<HTMLElement>('[data-el="clock"]');
  if(clock===null)throw new Error('Missing real loader clock');
  const writes=vi.spyOn(clock,'textContent','set');
  try{
    expect(loading.root.dataset['lean']!==undefined).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(clock.textContent).toBe('00:01.0');expect(writes).toHaveBeenCalledTimes(4);
    expect(frames).not.toHaveBeenCalled();
  }finally{loading.scope.dispose();}
});

test('the switch: the slot wins, else phone Low follows the default and desktop is never lean, and an inset card never is',()=>{
  vi.stubGlobal('location',new URL('https://example.invalid/'));
  initializeTier('phone');saveGraphicsMode('low');
  slot.write(false);expect(leanLoadingCard()).toBe(false);
  slot.write(true);resetLeanLoadingCard();expect(leanLoadingCard()).toBe(true);
  const inset=new Loading({id:'lean-inset',name:'Lean inset'},{inset:true});
  try{expect(inset.root.dataset['lean']!==undefined).toBe(false);}finally{inset.scope.dispose();}
  slot.reset();resetLeanLoadingCard();expect(leanLoadingCard()).toBe(LEAN_CARD_DEFAULT);
  resetLeanLoadingCard();saveGraphicsMode('high');expect(leanLoadingCard()).toBe(false);
  resetLeanLoadingCard();initializeTier('desktop');saveGraphicsMode('low');expect(leanLoadingCard()).toBe(false);
});
