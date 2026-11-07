import { expect, test, vi } from 'vitest';
import { Group } from 'three';
import { parse } from 'valibot';
import { HeldArmsSchema } from '@wildshard/format/heldArms';
import { HeldClaims } from '../src/client/game/loadout/claims';
import { Sword } from '../src/client/game/weapons/Sword';
import { GrappleTool } from '../src/client/game/grapple/tool';
import { EquipmentService } from '../src/client/engine/combat/EquipmentService';
import type { SwordArms } from '../src/client/engine/combat/view/melee';
import { heldEntry, slottedEnteredRows as enteredRows } from './fixtures/nineHeldEntry';

test('starter and tool slots lend the actual native sword and original entered grapple once',async()=>{
  const f=await heldEntry(false),install=vi.spyOn(GrappleTool.prototype,'install').mockImplementation(()=>undefined);
  try {
    const old=parse(HeldArmsSchema,f.ctx.product.section('held/arms'));
    if(!('kind' in old))throw new Error('Missing declared primary fixture');
    const held=HeldClaims.fromSlots({version:1,id:'held.primary',bindAt:'entered',pause:false,
      slots:[{id:'primary',kind:'blade',item:old.primary.item,source:{kind:'starter',blade:old.primary.blade,viewmodel:'declared',framing:old.primary.file}},
        {id:'tool',kind:'tool',item:enteredRows.grapple.item,tool:'grapple',source:enteredRows.grapple.source,presentation:enteredRows.grapple.presentation}],
      registration:['primary','tool'],equipment:{primary:'primary',extras:[]},selection:{unlock:[]},mount:[],refills:[],upgrades:[]});
    f.level.openKit();held.installPage(f.ctx);f.level.closeKit();
    const builder=f.ctx.game.runtime?.buildEquipment;if(builder===undefined)throw new Error('Missing native builder');
    const arms:SwordArms={root:new Group(),play:()=>undefined,update:()=>undefined,blade:()=>undefined};
    const built=await builder({raycast:()=>null},false,{arms});
    expect(built.primary).toBeInstanceOf(Sword);expect(held.melee(f.ctx).primary()).toBe(built.primary);
    const equipment=new EquipmentService(built.primary,{scope:f.scope});f.app.registerEquipment(equipment,f.scope);
    await held.enter(f.ctx,enteredRows);
    expect(equipment.current).toBe(built.primary);expect(equipment.tools).toHaveLength(1);
    expect(equipment.tools[0]).toBeInstanceOf(GrappleTool);expect(install).toHaveBeenCalledOnce();
    await expect(held.enter(f.ctx,enteredRows)).rejects.toThrow('already');expect(equipment.tools).toHaveLength(1);
  } finally {install.mockRestore();f.dispose();}
});
