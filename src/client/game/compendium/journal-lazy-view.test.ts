// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import { withOwner } from '@wildshard/engine/app/ownership';
import { Journal } from './Journal';
import { CompendiumState } from '../../../shared/game/compendium/state';
import type { ShardCompendium } from '../../../shared/game/compendium/types';

const owners: Scope[]=[];
afterEach(()=>{for(const owner of owners.splice(0))owner.dispose();vi.restoreAllMocks();});
const definition:ShardCompendium={chunkId:'journal-lazy-fixture',
  skin:{className:'journal-fixture',title:'Field notes',tabs:[{id:'beasts',label:'Beasts'}],stamp:()=> 'Taken',stats:()=>[]},
  entries:[{id:'first',kind:'species',tab:'beasts',name:'First animal',notes:'First notes',plate:{sketch:'/first.webp',model:{id:'first'}}},
    {id:'second',kind:'species',tab:'beasts',name:'Second animal',notes:'Second notes',plate:{sketch:'/second.webp'}}]};
function fixture(){
  const owner=new Scope('lazy-journal');owners.push(owner);
  const state=new CompendiumState(definition),journal=withOwner(owner,()=>new Journal(state));
  const opened=vi.fn<()=>void>(),closed=vi.fn<()=>void>();journal.onOpen=opened;journal.onClose=closed;
  return {owner,state,journal,opened,closed};
}

test('opening keeps synchronous pause callbacks and reads the latest saved discovery after loading',async()=>{
  const {state,journal,opened,closed}=fixture();
  expect(journal.root.querySelector('img')).toBeNull();
  journal.open('second');expect(journal.isOpen).toBe(true);expect(opened).toHaveBeenCalledOnce();
  state.take('second');await vi.dynamicImportSettled();
  await vi.waitFor(()=>{expect(journal.root.classList.contains('show')).toBe(true);});
  expect(journal.root.querySelector<HTMLElement>('[data-entry="second"]')?.dataset['state']).toBe('taken');
  expect(journal.root.querySelector('.ws-cmp-name')?.textContent).toBe('Second animal');
  journal.close();expect(closed).toHaveBeenCalledOnce();expect(journal.isOpen).toBe(false);
});

test('canceling a pending journal cannot reopen it or repeat the pause callbacks',async()=>{
  const {journal,opened,closed}=fixture();
  journal.open();journal.close();expect(document.querySelector('.ws-progress')).toBeNull();
  await vi.dynamicImportSettled();
  expect(journal.isOpen).toBe(false);expect(journal.root.classList.contains('show')).toBe(false);
  expect(opened).toHaveBeenCalledOnce();expect(closed).toHaveBeenCalledOnce();
});

test('late model actions stay absent until assigned, and retired journals never build book DOM',async()=>{
  const {journal,state}=fixture();state.take('first');journal.open('first');await vi.dynamicImportSettled();
  await vi.waitFor(()=>{expect(journal.root.classList.contains('show')).toBe(true);});
  expect(journal.root.querySelector('.ws-cmp-3d')).toBeNull();
  const view=vi.fn<NonNullable<Journal['onViewModel']>>();journal.onViewModel=view;
  journal.close();journal.open('first');
  journal.root.querySelector<HTMLButtonElement>('.ws-cmp-3d')?.click();
  expect(view).toHaveBeenCalledOnce();
  const retired=fixture();retired.journal.open();retired.owner.dispose();await vi.dynamicImportSettled();
  expect(retired.journal.isOpen).toBe(false);expect(retired.journal.root.isConnected).toBe(false);expect(retired.journal.root.querySelector('.ws-cmp-book')).toBeNull();
});
