// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import type { NetClient } from '@wildshard/engine/net/client';
import { CHAT_FADE_MS, CHAT_FRESH_MS, cornerOpen, lineLook } from './chatCorner';
import { chatLines } from './chatLines';
import type { VoiceChat, VoicePeer } from './voice';
import { voiceUi } from './voiceUi';

interface Said { line: number; from: number; name: string; text: string }
const owners: Scope[] = [];
beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] }); });
afterEach(() => { for (const owner of owners.splice(0)) owner.dispose(); vi.useRealTimers(); document.body.replaceChildren(); });

/** The real chat corner and voice controls over a stub link: what it says, what it reports, who is on voice. */
function corner(peers: readonly VoicePeer[] = []): { box: HTMLElement; field: HTMLInputElement; say: (said: Said) => void; sent: string[]; reported: number[]; muted: [string, boolean][] } {
  const scope = new Scope('chat-corner-test'); owners.push(scope);
  const heard: ((said: Said) => void)[] = [], sent: string[] = [], reported: number[] = [], muted: [string, boolean][] = [];
  const client = { welcome: { handle: 1 }, onChat: (fn: (said: Said) => void) => { heard.push(fn); return () => undefined; },
    say: (_to: string, text: string) => { sent.push(text); }, report: (line: number) => { reported.push(line); } } as unknown as NetClient;
  const roster = new Map(peers.map(peer => [peer.id, peer]));
  const voice = { state: 'on', speaking: false, level: 0, roster, onChange: () => () => undefined, toggle: () => undefined,
    mute: (id: string, on: boolean) => { muted.push([id, on]); } } as unknown as VoiceChat;
  const chat = chatLines(scope, client);
  voiceUi(scope, voice, chat);
  const field = chat.form.querySelector('input');
  if (field === null) throw new Error('no chat input');
  return { box: chat.box, field, say: said => { for (const fn of heard) fn(said); }, sent, reported, muted };
}
const look = (box: HTMLElement): (string | undefined)[] => [...box.querySelectorAll<HTMLElement>('[data-lines] > *')].map(row => row.dataset['look']);
const open = (box: HTMLElement): boolean => box.dataset['open'] !== undefined;
const outside = (): void => { document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); };

test('QA row 43: a line is fresh for 5 s, fades, then is gone from the calm corner', () => {
  expect(lineLook(0, 0)).toBe('fresh');
  expect(lineLook(0, CHAT_FRESH_MS - 1)).toBe('fresh');
  expect(lineLook(0, CHAT_FRESH_MS)).toBe('fading');
  expect(lineLook(0, CHAT_FRESH_MS + CHAT_FADE_MS)).toBe('gone');
});

test('QA row 43: only focusing the input opens the chat; outside, close, Escape and an empty Enter close it; sending keeps it', () => {
  expect(cornerOpen(false, 'focus')).toBe(true);
  expect(cornerOpen(false, 'inside')).toBe(false);
  expect(cornerOpen(false, 'sent')).toBe(false);
  expect(cornerOpen(true, 'inside')).toBe(true);
  expect(cornerOpen(true, 'sent')).toBe(true);
  for (const event of ['outside', 'close', 'empty'] as const) expect(cornerOpen(true, event)).toBe(false);
});

test('QA row 43: the corner\'s lines fade on the clock and stay listed for the open chat', () => {
  const { box, say } = corner();
  say({ line: 1, from: 2, name: 'Maren', text: 'anyone at the pier?' });
  expect(look(box)).toEqual(['fresh']);
  vi.advanceTimersByTime(3000);
  say({ line: 2, from: 1, name: 'You', text: 'on my way' });
  vi.advanceTimersByTime(2000);
  expect(look(box)).toEqual(['fading', 'fresh']);
  vi.advanceTimersByTime(CHAT_FADE_MS);
  expect(look(box)).toEqual(['gone', 'fresh']);
  vi.advanceTimersByTime(CHAT_FRESH_MS);
  expect(look(box)).toEqual(['gone', 'gone']);
  // the history is still there for the open chat, Report included on the other player's line
  expect(box.querySelectorAll('[data-lines] > *').length).toBe(2);
  expect(box.querySelectorAll('[data-lines] button').length).toBe(1);
});

test('QA row 43: focusing the input expands the chat; a tap inside keeps it, a tap outside, × or Escape collapses it', () => {
  const { box, field } = corner();
  expect(open(box)).toBe(false);
  field.focus();
  expect(open(box)).toBe(true);
  field.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  expect(open(box)).toBe(true);
  outside();
  expect(open(box)).toBe(false);
  expect(document.activeElement).not.toBe(field);
  field.focus();
  box.querySelector<HTMLButtonElement>('[data-head] button')?.click();
  expect(open(box)).toBe(false);
  field.focus();
  expect(box.dataset['wsOwnEscape']).toBe('');
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(open(box)).toBe(false);
  expect(box.dataset['wsOwnEscape']).toBeUndefined();
  // Escape from a button in the open chat (a Mute, a Report, the ×) closes it too, and lets the button go
  field.focus();
  const button = box.querySelector<HTMLButtonElement>('[data-head] button');
  button?.focus();
  button?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(open(box)).toBe(false);
  expect(document.activeElement).not.toBe(button);
});

test('QA row 43: the open chat sends and stays open; an empty Enter closes it; keys never reach the game', () => {
  const { box, field, sent } = corner();
  const game = vi.fn<() => void>();
  document.addEventListener('keydown', game);
  field.focus(); field.value = 'hello';
  box.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
  expect(sent).toEqual(['hello']);
  expect(open(box)).toBe(true);
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', bubbles: true }));
  expect(game).not.toHaveBeenCalled();
  box.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
  expect(open(box)).toBe(false);
  document.removeEventListener('keydown', game);
});

test('QA row 43: the players on voice are a list in the open chat with mute and the speaking glow; Report works there', () => {
  const peers: VoicePeer[] = [{ id: 'p0', name: 'Maren', speaking: true, muted: false, linked: true }, { id: 'p1', name: 'Kai', speaking: false, muted: true, linked: true }];
  const { box, field, say, reported, muted } = corner(peers);
  const list = box.querySelector<HTMLElement>('#ws-voice-peers');
  expect(list?.hidden).toBe(false);
  // the corner's CSS hides the list until the chat is open (no chips in the calm corner)
  expect(document.head.textContent).toContain('#ws-chat:not([data-open])>#ws-voice-peers{display:none}');
  field.focus();
  const rows = [...(list?.querySelectorAll<HTMLButtonElement>('button[data-peer]') ?? [])];
  expect(rows.map(row => [row.dataset['peer'], row.dataset['speaking'], row.textContent])).toEqual([['p0', 'true', 'MarenMute'], ['p1', 'false', 'KaiMuted']]);
  rows[1]?.click();
  expect(muted).toEqual([['p1', false]]);
  say({ line: 7, from: 2, name: 'Maren', text: 'ok' });
  box.querySelector<HTMLButtonElement>('[data-lines] button')?.click();
  expect(reported).toEqual([7]);
  expect(open(box)).toBe(true);
});
