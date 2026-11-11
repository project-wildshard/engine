// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import type { NetClient } from '@wildshard/engine/net/client';
import { CHAT_FADE_MS, CHAT_FRESH_MS, cornerOpen, lineLook } from './chatCorner';
import { chatLines } from './chatLines';
import { VoiceChat, type VoiceHeard, type VoicePeer } from './voice';
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

/** The voice controls over a voice that moves the way the real one does on a press: off, on, off. */
function voiceCorner(state: 'off' | 'on' | 'denied' | 'unsupported'): { box: HTMLElement; voice: { state: string; toggles: number }; tip: () => string | null; press: () => void } {
  const scope = new Scope('voice-feedback-test'); owners.push(scope);
  const client = { welcome: { handle: 1 }, onChat: () => () => undefined, say: () => undefined, report: () => undefined } as unknown as NetClient;
  const changes = new Set<() => void>();
  const voice = { state: state as string, toggles: 0, speaking: false, level: 0, roster: new Map<string, VoicePeer>(), onChange: (fn: () => void) => { changes.add(fn); return () => { changes.delete(fn); }; },
    toggle() { this.toggles++; this.state = this.state === 'on' ? 'off' : this.state === 'denied' || this.state === 'off' ? (state === 'denied' ? 'denied' : 'on') : this.state; for (const fn of changes) fn(); },
    mute: () => undefined };
  const chat = chatLines(scope, client);
  voiceUi(scope, voice as unknown as VoiceChat, chat);
  const tip = (): string | null => { const el = chat.box.querySelector<HTMLElement>('#ws-voice-tip'); return el === null || el.hidden === true ? null : el.querySelector('span')?.textContent ?? null; };
  const press = (): void => { document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyB', key: 'b', bubbles: true })); };
  return { box: chat.box, voice, tip, press };
}

test('QA row 6: B says what it did: on shows the mic on, off says "Voice off" for a moment', () => {
  const { box, voice, tip, press } = voiceCorner('off');
  press();
  expect(voice.state).toBe('on');
  expect(box.querySelector<HTMLElement>('#ws-voice')?.dataset['state']).toBe('on');
  expect(tip()).toContain('You\'re on voice');
  press();
  expect(voice.state).toBe('off');
  expect(tip()).toBe('Voice off. Press B to talk again.');
  vi.advanceTimersByTime(4000);
  expect(tip()).toBeNull();
});

test('QA row 6: a press shows a closed tip again, so a second "blocked" is never silent', () => {
  const { box, tip, press } = voiceCorner('denied');
  expect(tip()).toContain('Microphone blocked');
  box.querySelector<HTMLButtonElement>('#ws-voice-tip button')?.click();
  expect(tip()).toBeNull();
  press();
  expect(tip()).toContain('Microphone blocked');
});

test('QA row 6: B under an open menu does nothing, because the mic it would open is hidden there', () => {
  const { voice, press } = voiceCorner('off');
  document.documentElement.dataset['wsMenu'] = 'open';
  try { press(); expect(voice.toggles).toBe(0); }
  finally { delete document.documentElement.dataset['wsMenu']; }
  press();
  expect(voice.toggles).toBe(1);
});

test('QA row 6: a browser with no voice has no mic, and B says why for a moment', () => {
  const { box, tip, press } = voiceCorner('unsupported');
  expect(box.querySelector('#ws-voice')).toBeNull();
  expect(tip()).toBeNull();
  press();
  expect(tip()).toBe('Voice chat doesn\'t work in this browser. Text chat still does.');
  vi.advanceTimersByTime(5000);
  expect(tip()).toBeNull();
});

test('QA row 6: the real voice through asking, joining and on; B off says so, and the server saying full never does', async () => {
  const scope = new Scope('voice-real-test'); owners.push(scope);
  const hear = new Set<(word: VoiceHeard) => void>(), sent: object[] = [];
  const say = (word: VoiceHeard): void => { for (const fn of hear) fn(word); };
  vi.stubGlobal('RTCPeerConnection', (): void => undefined); // only its presence matters until a peer joins
  const stream = { getTracks: () => [], getAudioTracks: () => [] } as unknown as MediaStream;
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: () => Promise.resolve(stream) } });
  try {
    const client = { welcome: { handle: 1 }, onChat: () => () => undefined, say: () => undefined, report: () => undefined } as unknown as NetClient;
    const voice = new VoiceChat(scope, { send: word => { sent.push(word); }, on: fn => { hear.add(fn); return () => { hear.delete(fn); }; } }, '');
    const chat = chatLines(scope, client);
    voiceUi(scope, voice, chat);
    const button = chat.box.querySelector<HTMLElement>('#ws-voice'), tip = (): string | null => { const el = chat.box.querySelector<HTMLElement>('#ws-voice-tip'); return el === null || el.hidden === true ? null : el.querySelector('span')?.textContent ?? null; };
    const press = (): void => { document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyB', key: 'b', bubbles: true })); };
    press();
    expect(button?.dataset['state']).toBe('asking');
    expect(tip()).toBe('Allow the microphone when your browser asks.');
    await vi.waitFor(() => { expect(button?.dataset['state']).toBe('joining'); });
    expect(tip()).toBe('Joining voice…');
    say({ k: 'you', id: 'me' });
    expect(sent).toContainEqual({ k: 'join' });
    say({ k: 'hi', ice: [], peers: [] });
    expect(button?.dataset['state']).toBe('on');
    expect(tip()).toContain('You\'re on voice');
    press();
    expect(button?.dataset['state']).toBe('off');
    expect(tip()).toBe('Voice off. Press B to talk again.');
    vi.advanceTimersByTime(4000);
    expect(tip()).toBeNull();
    // the server's "full" is not a press: it says full, never "Voice off"
    press();
    await vi.waitFor(() => { expect(button?.dataset['state']).toBe('joining'); });
    say({ k: 'you', id: 'me' }); say({ k: 'full' });
    expect(button?.dataset['state']).toBe('full');
    expect(tip()).toBe('Voice is full here: 8 players are on it already.');
  } finally { vi.unstubAllGlobals(); Reflect.deleteProperty(navigator, 'mediaDevices'); }
});

test('Jake, 2026-11-10: a keyboard page puts the chat bottom left too, over what stands there; the touch HUD keeps its place', () => {
  const hud = document.createElement('div'), coins = document.createElement('div'), alert = document.createElement('div');
  hud.id = 'hud'; coins.className = 'ws-loot-chip'; alert.className = 'ws-perf-panel';
  hud.append(coins); document.body.append(hud, alert);
  const at = (el: HTMLElement, left: number, top: number, width: number, height: number): void => {
    el.getBoundingClientRect = () => ({ left, top, width, height, x: left, y: top, right: left + width, bottom: top + height, toJSON: () => ({}) });
  };
  const { box } = corner();
  at(box, 8, 0, 260, 60); at(coins, 22, innerHeight - 120, 60, 28);
  vi.advanceTimersByTime(500);
  // the base corner is anchored to the bottom, by a lift the page measures: just over the coins
  expect(document.head.textContent).toContain('top:auto;bottom:calc(env(safe-area-inset-bottom,0px) + var(--ws-chat-lift))');
  expect(box.dataset['touch']).toBeUndefined();
  expect(box.style.getPropertyValue('--ws-chat-lift')).toBe('130px');
  // a many-line Developer alert at the left: the corner climbs over it, however tall it is
  at(alert, 12, innerHeight - 260, 420, 130);
  vi.advanceTimersByTime(500);
  expect(box.style.getPropertyValue('--ws-chat-lift')).toBe('270px');
  // one taller than half the window still counts: it stands on the bottom half
  at(alert, 12, innerHeight - 440, 420, 310);
  vi.advanceTimersByTime(500);
  expect(box.style.getPropertyValue('--ws-chat-lift')).toBe('450px');
  // the open chat keeps room for its header, lines and input: in a short window it drops over what is under it
  expect(document.head.textContent).toContain('--ws-chat-open-lift:min(var(--ws-chat-lift),calc(100vh - 264px - env(safe-area-inset-top,0px)))');
  // Settings' Touch controls on a mouse: the touch HUD is up, so the corner takes its place over MOVE
  hud.classList.add('touch');
  vi.advanceTimersByTime(500);
  expect(box.dataset['touch']).toBe('');
  expect(document.head.textContent).toContain('#ws-chat[data-touch]{top:calc(var(--ws-vh,100vh) - var(--ws-chat-bar) - var(--ws-chat-gap));bottom:auto;');
});
