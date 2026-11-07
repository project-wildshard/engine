import { app } from '@wildshard/engine/app/runtime';
import type { Action } from '@wildshard/engine/input/InputService';
import type { InputContextDef } from '@wildshard/engine/level/context';
import { engineString } from '@wildshard/engine/strings';

declare module '@wildshard/engine/input/InputService' { interface ActionMap { bag: true } }

const movement = ['move', 'look', 'move.forward', 'move.back', 'move.left', 'move.right'] as const;
const moveKeys = { 'move.forward': ['KeyW'], 'move.back': ['KeyS'], 'move.left': ['KeyA'], 'move.right': ['KeyD'] };
const footMoveKeys = { 'move.forward': ['KeyW', 'ArrowUp'], 'move.back': ['KeyS', 'ArrowDown'], 'move.left': ['KeyA', 'ArrowLeft'], 'move.right': ['KeyD', 'ArrowRight'] };
const slots = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
const slotKeys = Object.fromEntries(slots.map((slot) => [`swap.slot.${slot}`, [`Digit${slot}`]]));
export const INPUT_CONTEXTS: readonly InputContextDef[] = [
  { id: 'onFoot', actions: [...movement, 'jump', 'sprint', 'dodge', 'use', 'swap', 'swap.next', 'swap.prev',
      ...slots.map((slot): Action => `swap.slot.${slot}`), 'lock', 'pause', 'bag', 'map', 'journal', 'note', 'quickNote', 'hover', 'help'],
    keys: { ...footMoveKeys, ...slotKeys, jump: ['Space'], sprint: ['ShiftLeft', 'ShiftRight'],
      dodge: ['KeyV', 'AltLeft'], use: ['KeyE'], swap: ['KeyQ'], lock: ['Mouse1', 'KeyZ'], pause: ['Escape'], bag: ['KeyI', 'Tab'], map: ['KeyM'], journal: ['KeyJ'], note: ['KeyN'], quickNote: ['F8'], hover: ['KeyH'], help: ['F1', 'Slash'] } },
  { id: 'weapon.melee', actions: ['attack', 'heavy', 'lock'], keys: { attack: ['Mouse0', 'KeyF'], heavy: ['Mouse2'] }, touch: { mode: 'melee', lockable: true, relabel: { r0: { label: engineString('s_852b889c1d23'), tone: 'rest' } } } },
  { id: 'weapon.ranged', actions: ['attack', 'aim', 'reload'], keys: { attack: ['Mouse0', 'KeyF'], aim: ['Mouse2'], reload: ['KeyR'] }, touch: { mode: 'ranged', lockable: false, relabel: { r0: { label: engineString('s_8c1280a20004'), tone: 'rest' }, aim: { label: engineString('s_3c421fac5f36'), tone: 'rest' } } } },
  { id: 'weapon.bow', actions: ['attack', 'aim'], keys: { attack: ['Mouse0'], aim: ['Mouse2'] }, touch: { mode: 'bow', lockable: false, relabel: { r0: { label: engineString('s_8c1280a20004'), tone: 'rest' }, aim: { label: engineString('s_3c421fac5f36'), tone: 'rest' } } } },
  { id: 'weapon.spear', actions: ['attack', 'aim'], keys: { attack: ['Mouse0', 'KeyF'], aim: ['Mouse2'] }, touch: { mode: 'throwing', lockable: true, relabel: { r0: { label: engineString('s_fbd474bd18c4'), tone: 'rest' }, aim: { label: engineString('s_9871e517137d'), tone: 'rest' } } } },
  { id: 'swim', actions: [...movement, 'dive', 'surface'], blocks: ['attack', 'heavy', 'aim', 'reload', 'jump', 'dodge', 'sprint', 'crouch'],
    keys: { dive: ['Space'], surface: ['ShiftLeft', 'ShiftRight'] }, touch: { relabel: { jump: { label: engineString('s_1d7cf9037135'), tone: 'rest' }, r1: { label: engineString('s_15c0f7da1543'), tone: 'rest' } } } },
  { id: 'board', actions: ['hover', 'jump'], blocks: ['dodge', 'crouch', 'crouch.hold', 'sprint'], keys: { hover: ['KeyH'], jump: ['Space'] } },
  { id: 'title', actions: ['confirm', 'nav.left', 'nav.right'], blocks: 'below', enabled: () => app.state === 'title', keys: { confirm: ['*'], 'nav.left': ['ArrowLeft'], 'nav.right': ['ArrowRight'] } },
  { id: 'menu', actions: ['nav.left', 'nav.right', 'tab', 'confirm', 'back', 'pause', 'bag', 'map', 'journal', 'note', 'use'], blocks: 'below',
    keys: { 'nav.left': ['ArrowLeft', 'KeyA'], 'nav.right': ['ArrowRight', 'KeyD'], tab: ['Tab'], confirm: ['Enter', 'Space'], use: ['KeyE'], back: ['Escape'], map: ['KeyM'], journal: ['KeyJ'], note: ['KeyN'] } },
  { id: 'dialog', actions: ['use', 'confirm', 'back'], blocks: ['attack', 'heavy', 'aim', 'reload', 'swap', 'jump', 'dodge'], keys: { use: ['KeyE'], confirm: ['Enter'], back: ['Escape'] } },
  { id: 'explore', actions: [...movement, 'fly.up', 'fly.down', 'fly.boost', 'pane.1', 'pane.2', 'pane.3', 'map', 'back', 'quickNote', 'focus'], blocks: 'below',
    keys: { ...moveKeys, 'fly.up': ['KeyE', 'Space'], 'fly.down': ['KeyQ', 'ControlLeft'], 'fly.boost': ['ShiftLeft', 'ShiftRight'], 'pane.1': ['Digit1'], 'pane.2': ['Digit2'], 'pane.3': ['Digit3'], map: ['KeyM'], quickNote: ['F8'], focus: ['KeyF'], back: ['Escape'] } },
];
