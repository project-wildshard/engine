import {expect,test} from 'vitest';
import {SweptMeleeCore} from './sweptMeleeCore';

test('an explicitly named mounted pass restores its active window without joining the light combo',()=>{
  const light={windup:.1,slashEnd:.2,total:.3,damage:1},heavy={...light,damage:2},pass={...light,total:.4};
  const make=()=>new SweptMeleeCore({combo:[light],heavy},{cooldown:.2,comboGap:.5,chainLag:.05,heavyCharge:.3},
    {queue:()=>undefined,consume:()=>false},{start:()=>undefined,charge:()=>undefined});
  const first=make(),restored=make();
  expect(first.strike(pass,false)).toBe(true);first.step(.13,.13,1,false);
  expect(()=>first.snapshot()).toThrow('outside its move set');
  const saved=first.snapshot([pass]);
  expect(()=>restored.restore(saved)).toThrow('Invalid swept swing continuation');
  restored.restore(saved,[pass]);expect(restored.move).toBe(pass);
  for(let frame=0;frame<40;frame++){
    const time=.13+(frame+1)/60;
    expect(restored.step(1/60,time,1,false)).toEqual(first.step(1/60,time,1,false));
    expect(restored.snapshot([pass])).toEqual(first.snapshot([pass]));
  }
  first.tryFire();restored.tryFire();expect(first.move).toBe(light);expect(restored.move).toBe(light);
});
