// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import type { NetClient } from '@wildshard/engine/net/client';
import { CHAT_FADE_MS, CHAT_FRESH_MS, badgeText, cornerOpen, cornerShown, lineLook } from './chatCorner';
import { chatDock, chatLines } from './chatLines';
import { VOICE_GIVE_UP_MS, VoiceChat, type VoiceHeard, type VoicePeer } from './voice';
import { voiceUi } from './voiceUi';
import { voiceSettings } from '@wildshard/engine/ui/voiceSettings';

interface Said { line: number; from: number; name: string; text: string }
const owners: Scope[] = [];
const marks = document.documentElement.dataset;
// the corner shows only in play (QA 2026-11-11 loading HUD): these tests stand in the world unless they say otherwise
beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] }); marks['wsState'] = 'play'; });
afterEach(() => { for (const owner of owners.splice(0)) owner.dispose(); vi.useRealTimers(); document.body.replaceChildren(); delete marks['wsState']; delete marks['wsMenu']; delete marks['wsCovered']; delete marks['wsTalk']; });

/** The real chat corner and voice controls over a stub link: what it says, what it reports, who is on voice. */
function corner(peers: readonly VoicePeer[] = []): { box: HTMLElement; field: HTMLInputElement; say: (said: Said) => void; sent: string[]; reported: number[]; muted: [string, boolean][] } {
  const scope = new Scope('chat-corner-test'); owners.push(scope);
  const heard: ((said: Said) => void)[] = [], sent: string[] = [], reported: number[] = [], muted: [string, boolean][] = [];
  const client = { welcome: { handle: 1 }, onChat: (fn: (said: Said) => void) => { heard.push(fn); return () => undefined; },
    say: (_to: string, text: string) => { sent.push(text); }, report: (line: number) => { reported.push(line); } } as unknown as NetClient;
  const roster = new Map(peers.map(peer => [peer.id, peer]));
  const voice = { state: 'on', speaking: false, level: 0, roster, unreachable: [], mode: 'toggle', sending: true, onChange: () => () => undefined, toggle: () => undefined, press: () => undefined, release: () => undefined,
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

/** Whether the corner shows: `data-away` is the corner's own mark, and the mic and its tip sit inside it. */
const away = (box: HTMLElement): boolean => box.dataset['away'] !== undefined;
const settle = (): Promise<void> => Promise.resolve();

test('QA 2026-11-11 (Jake: "don\'t show microphone and chat on the loading screen"): the corner shows only in play', async () => {
  for (const [state, menu, covered, shown] of [['boot', false, false, false], ['title', false, false, false], ['loading', false, true, false],
    ['play', false, true, false], ['play', true, false, false], ['paused', true, false, false], ['error', false, false, false],
    ['play', false, false, true], ['explore', false, false, true], ['practice', false, false, true], ['playground', false, false, true]] as const) {
    expect(cornerShown({ ...(state === undefined ? {} : { wsState: state }), ...(menu ? { wsMenu: 'open' } : {}), ...(covered ? { wsCovered: 'loading' } : {}) }), `${state} menu=${String(menu)} covered=${String(covered)}`).toBe(shown);
  }
  expect(cornerShown({})).toBe(false);
  // the page as the loading card's READY / PLAY leaves it: the state is already play, the card still covers the world
  marks['wsState'] = 'loading'; marks['wsCovered'] = 'loading';
  const { box } = corner();
  expect(away(box)).toBe(true);
  marks['wsState'] = 'play'; await settle();
  expect(away(box)).toBe(true);
  delete marks['wsCovered']; await settle();
  expect(away(box)).toBe(false);
  marks['wsMenu'] = 'open'; await settle();
  expect(away(box)).toBe(true);
  delete marks['wsMenu']; marks['wsState'] = 'title'; await settle();
  expect(away(box)).toBe(true);
});

test('QA 2026-11-11: the mic tip\'s first 15 s start when the corner first shows, and B does nothing on the loading card', async () => {
  localStorage.clear();
  marks['wsState'] = 'loading'; marks['wsCovered'] = 'loading';
  const { voice, tip, press } = voiceCorner('off');
  press();
  expect(voice.toggles).toBe(0);
  vi.advanceTimersByTime(20_000);
  marks['wsState'] = 'play'; delete marks['wsCovered']; await settle();
  vi.advanceTimersByTime(1000);
  expect(tip()).toBe('Press B (or click the mic) to talk with players here.');
  press();
  expect(voice.toggles).toBe(1);
});

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
  const peers: VoicePeer[] = [{ id: 'p0', name: 'Maren', speaking: true, muted: false, linked: true, far: false }, { id: 'p1', name: 'Kai', speaking: false, muted: true, linked: true, far: false }];
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
  const voice = { state: state as string, toggles: 0, speaking: false, level: 0, roster: new Map<string, VoicePeer>(), unreachable: [], onChange: (fn: () => void) => { changes.add(fn); return () => { changes.delete(fn); }; },
    toggle() { this.toggles++; this.state = this.state === 'on' ? 'off' : this.state === 'denied' || this.state === 'off' ? (state === 'denied' ? 'denied' : 'on') : this.state; for (const fn of changes) fn(); },
    mode: 'toggle', get sending() { return this.state === 'on'; }, press() { this.toggle(); }, release: () => undefined, mute: () => undefined };
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

test('VOICE-POLISH V11: in hold mode B joins voice and opens the mic only while held; the mic button still leaves', async () => {
  const scope = new Scope('voice-hold-test'); owners.push(scope);
  const hear = new Set<(word: VoiceHeard) => void>(), sent: object[] = [];
  const say = (word: VoiceHeard): void => { for (const fn of hear) fn(word); };
  vi.stubGlobal('RTCPeerConnection', (): void => undefined);
  const track = { enabled: true, kind: 'audio', stop: () => undefined }, stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: () => Promise.resolve(stream) } });
  voiceSettings.write({ mode: 'hold' });
  try {
    const client = { welcome: { handle: 1 }, onChat: () => () => undefined, say: () => undefined, report: () => undefined } as unknown as NetClient;
    const voice = new VoiceChat(scope, { send: word => { sent.push(word); }, on: fn => { hear.add(fn); return () => { hear.delete(fn); }; } }, '');
    const chat = chatLines(scope, client);
    voiceUi(scope, voice, chat);
    const button = chat.box.querySelector<HTMLElement>('#ws-voice');
    const key = (type: 'keydown' | 'keyup'): void => { document.body.dispatchEvent(new KeyboardEvent(type, { code: 'KeyB', key: 'b', bubbles: true })); };
    say({ k: 'you', id: 'me' });
    key('keydown');
    await vi.waitFor(() => { expect(sent).toContainEqual({ k: 'join' }); });
    say({ k: 'hi', ice: [], peers: [] });
    expect(button?.dataset['state']).toBe('on');
    expect(track.enabled).toBe(true); expect(voice.sending).toBe(true); expect(button?.dataset['ptt']).toBe('held');
    key('keyup');
    expect(track.enabled).toBe(false); expect(voice.sending).toBe(false); expect(button?.dataset['ptt']).toBe('idle');
    expect(button?.dataset['state']).toBe('on'); // still on voice, hearing everyone
    key('keydown'); expect(track.enabled).toBe(true);
    window.dispatchEvent(new Event('blur')); expect(track.enabled).toBe(false); // a key let go in another window still closes the mic
    voiceSettings.write({ mode: 'toggle' }); expect(track.enabled).toBe(true); // toggle mode: on is open
    button?.click(); expect(button?.dataset['state']).toBe('off');
  } finally { voiceSettings.write({ mode: 'toggle' }); vi.unstubAllGlobals(); Reflect.deleteProperty(navigator, 'mediaDevices'); }
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

test('a voice peer takes the body the relay renames it to (the lead seat)', () => {
  const scope = new Scope('voice-rename-test'); owners.push(scope);
  const listeners: ((word: VoiceHeard) => void)[] = [];
  const voice = new VoiceChat(scope, { send: () => undefined, on: listener => { listeners.push(listener); return () => undefined; } });
  const say = (word: VoiceHeard): void => { for (const listener of listeners) listener(word); };
  say({ k: 'you', id: 'me' });
  say({ k: 'roster', peers: [{ id: 'lead', name: 'Ann#4821', body: 'device-body' }] });
  say({ k: 'roster', peers: [{ id: 'lead', name: 'Ann#4821', body: 'actor.player' }] });
  expect(voice.roster.get('lead')?.body).toBe('actor.player');
});

// MOBILE-KEYBOARD MK2 (J297, Jake 2026-11-12 17:44 Cancún: "move the whole chat to be just above the keyboard"): the open chat
// tells the game how much of the band over the keyboard its dock takes, and gives it back as it closes.
test('the open chat reserves its dock over a phone keyboard, and gives it back on close', () => {
  expect(chatDock(445)).toBe(150); // portrait: input and three lines
  expect(chatDock(170)).toBe(85); // landscape: half the band, so the world keeps a strip
  // Jake's iPhone 17 Pro with the keyboard up: 445 pt of the page still shows
  vi.stubGlobal('visualViewport', Object.assign(new EventTarget(), { height: 445, offsetTop: 0, scale: 1 }));
  try {
    const { box, field } = corner();
    const root = document.documentElement;
    expect(root.dataset['wsKbReserve']).toBeUndefined();
    field.dispatchEvent(new FocusEvent('focus'));
    expect(open(box)).toBe(true);
    expect(root.dataset['wsKbReserve']).toBe('156');
    expect(box.style.getPropertyValue('--ws-chat-dock')).toBe('150px');
    outside();
    expect(open(box)).toBe(false);
    expect(root.dataset['wsKbReserve']).toBeUndefined();
  } finally { vi.unstubAllGlobals(); }
});

// MOBILE-KEYBOARD MK5 (J297, Jake 2026-11-12 17:44 Cancún: "fix the top of it"): after Done closes the phone keyboard the chat
// stays open, and it stood as a tall fixed panel with its few lines at the bottom and an empty dark top. Without the keyboard
// the open chat on a phone sizes to its lines: its bottom edge stays where it was, its height is what the lines need, and the
// old tall size is only its ceiling (in portrait and in landscape).
test('MK5: the open chat on a phone without a keyboard sizes to its lines, no empty top', () => {
  const { box } = corner();
  box.dataset['touch'] = '';
  const sheet = [...document.head.querySelectorAll('style')].map(style => style.textContent).find(text => text.includes('#ws-chat')) ?? '';
  const rules = (selector: string, within = sheet): string[] => [...within.matchAll(/([^{}]+)\{([^{}]*)\}/gu)].filter(match => match[1]?.trim() === selector).map(match => match[2] ?? '');
  const landscape = /@media \(orientation:landscape\)\{([\s\S]*?\})\s*\}/u.exec(sheet)?.[1] ?? '';
  expect(landscape).not.toBe('');
  for (const [where, within] of [['portrait', sheet], ['landscape', landscape]] as const) {
    const touchOpen = rules('#ws-chat[data-touch][data-open]', within).join(';');
    expect(touchOpen, where).not.toMatch(/(^|;)height:(?!auto)/u);
  }
  const portrait = rules('#ws-chat[data-touch][data-open]').join(';');
  // bottom-anchored at the old panel's bottom, the content's own height, the old height as its most
  expect(portrait).toMatch(/(^|;)height:auto/u);
  expect(portrait).toMatch(/transform:translateY\(-100%\)/u);
  expect(portrait).toMatch(/max-height:var\(--ws-chat-open-h\)/u);
  expect(portrait).toMatch(/top:calc\([^;]*var\(--ws-chat-open-h\)\)/u);
  // the keyboard dock still wins while the keyboard is up: a fixed compact height
  expect(rules(`html[data-ws-keyboard] #ws-chat[data-open]`).join(';')).toMatch(/height:var\(--ws-chat-dock/u);
});

// MMO-FAILURE-MODES FM8 mode 32 (meta docs/plans/MMO-FAILURE-MODES-PLAN.md): a peer voice can't reach after every retry says so,
// text chat goes on, and Try again asks for the relay list afresh and offers again.
test('FM8 mode 32: voice that cannot reach a peer says voice-failed, and Try again offers afresh', async () => {
  const scope = new Scope('voice-failed-test'); owners.push(scope);
  const hear = new Set<(word: VoiceHeard) => void>();
  const say = (word: VoiceHeard): void => { for (const fn of hear) fn(word); };
  let offers = 0;
  // a network where no link ever comes up: every offer fails before it is sent
  vi.stubGlobal('RTCPeerConnection', class { connectionState = 'new'; ontrack = null; onicecandidate = null; onconnectionstatechange = null;
    addTrack(): void { /* no track */ } close(): void { /* nothing open */ } getReceivers(): never[] { return []; } createOffer(): Promise<never> { offers++; return Promise.reject(new Error('no route')); } });
  const stream = { getTracks: () => [], getAudioTracks: () => [] } as unknown as MediaStream;
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: () => Promise.resolve(stream) } });
  try {
    const client = { welcome: { handle: 1 }, onChat: () => () => undefined, say: () => undefined, report: () => undefined } as unknown as NetClient;
    const voice = new VoiceChat(scope, { send: () => undefined, on: fn => { hear.add(fn); return () => { hear.delete(fn); }; } }, '');
    const chat = chatLines(scope, client);
    voiceUi(scope, voice, chat);
    const el = (): HTMLElement | null => chat.box.querySelector<HTMLElement>('#ws-voice-tip');
    const tip = (): string | null => { const node = el(); return node === null || node.hidden === true ? null : node.querySelector('span')?.textContent ?? null; };
    document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyB', key: 'b', bubbles: true }));
    say({ k: 'you', id: 'me' });
    await vi.waitFor(() => { expect(voice.state).toBe('joining'); });
    say({ k: 'roster', peers: [{ id: 'ann', name: 'Ann#4821' }] });
    say({ k: 'hi', ice: [], peers: ['ann'] });
    expect(voice.state).toBe('on');
    await vi.waitFor(() => { expect(offers).toBe(1); });
    // still trying: no word of failure before every retry had its time
    await vi.advanceTimersByTimeAsync(VOICE_GIVE_UP_MS - 1000);
    expect(voice.unreachable).toEqual([]);
    expect(el()?.dataset['failmode']).toBeUndefined();
    await vi.advanceTimersByTimeAsync(2000);
    expect(voice.unreachable.map(peer => peer.id)).toEqual(['ann']);
    expect(tip()).toBe('Voice couldn\'t connect to Ann#4821 on this network. Text chat still works.');
    expect(el()?.dataset['failmode']).toBe('voice-failed');
    expect(voice.state).toBe('on'); // voice stays on for everyone it can reach; text chat never waited on it
    // 32b: holding talk then reaches no one, and says so; the mic still opens for a link that comes up mid-hold
    voiceSettings.write({ mode: 'hold' });
    document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyB', key: 'b', bubbles: true }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(el()?.dataset['failmode']).toBe('voice-failed-blocked');
    expect(tip()).toBe('Voice can\'t connect here, so no one hears you. Text chat still works.');
    expect(voice.state).toBe('on');
    document.body.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyB', key: 'b', bubbles: true }));
    el()?.querySelector<HTMLButtonElement>('button[data-action="retry"]')?.click();
    await vi.waitFor(() => { expect(offers).toBe(2); });
    expect(voice.unreachable).toEqual([]);
    await vi.advanceTimersByTimeAsync(500);
    expect(el()?.dataset['failmode']).toBeUndefined();
  } finally { voiceSettings.write({ mode: 'toggle' }); vi.unstubAllGlobals(); Reflect.deleteProperty(navigator, 'mediaDevices'); }
});

test('J457 (Jake: "if you do start talking to NPCs, we hide the chat UI and we hide the microphone button"): a dialogue sends the corner away', async () => {
  expect(cornerShown({ wsState: 'play', wsTalk: 'open' })).toBe(false);
  const { box, field } = corner();
  const mic = box.querySelector('#ws-voice'), tip = box.querySelector('#ws-voice-tip');
  // the input, the mic and the mic's tip all live in the corner, so the corner's own mark hides all three
  expect(mic).not.toBeNull(); expect(tip).not.toBeNull();
  expect(away(box)).toBe(false);
  // typing when an NPC starts talking: the open chat closes and the corner leaves
  field.focus(); expect(open(box)).toBe(true);
  marks['wsTalk'] = 'open'; await settle();
  expect(away(box)).toBe(true); expect(open(box)).toBe(false);
  // a fight while the box is open (the player goes down and stands again) keeps the corner away
  marks['wsState'] = 'dead'; await settle(); expect(away(box)).toBe(true);
  marks['wsState'] = 'play'; await settle(); expect(away(box)).toBe(true);
  // the box closes: input, mic and tip come back
  delete marks['wsTalk']; await settle();
  expect(away(box)).toBe(false);
  expect(box.contains(mic)).toBe(true); expect(box.contains(tip)).toBe(true);
});

// J473 (Jake, 2026-11-19 ~17:12 Cancún: "a chat icon with a badge is nice"): on a phone the closed corner is two icons stacked
// above MOVE, the mic over the chat icon; the input box is gone until the chat opens.
test('J473 row 1: a phone\'s closed corner is the mic over a chat icon with an amber unread badge (9+), cleared on open', () => {
  expect([0, 1, 9, 10, 42].map(badgeText)).toEqual(['', '1', '9', '9+', '9+']);
  const hud = document.createElement('div'); hud.id = 'hud'; hud.className = 'touch'; document.body.append(hud);
  const { box, field, say } = corner();
  vi.advanceTimersByTime(500);
  expect(box.dataset['touch']).toBe('');
  const icon = box.querySelector<HTMLButtonElement>('#ws-chat-icon'), mic = box.querySelector('#ws-voice');
  if (icon === null || mic === null) throw new Error('no chat icon or mic');
  const badge = (): string => icon.querySelector('[data-badge]')?.textContent ?? '';
  // both icons sit in the closed corner's row, the mic first (on top), the input hidden there
  const sheet = document.head.textContent;
  expect(sheet).toContain('#ws-chat[data-touch]:not([data-open])>form{position:relative;flex-direction:column');
  expect(sheet).toContain('#ws-chat[data-touch]:not([data-open]) #ws-voice{order:1;width:36px;height:36px}');
  expect(sheet).toContain('#ws-chat[data-touch]:not([data-open]) #ws-chat-icon{order:2;display:grid}');
  expect(sheet).toMatch(/#ws-chat\[data-touch\]:not\(\[data-open\]\)>form>input\{[^}]*opacity:0;pointer-events:none/u);
  // others' lines count; your own don't
  say({ line: 1, from: 2, name: 'Maren', text: 'hi' });
  say({ line: 2, from: 1, name: 'You', text: 'hey' });
  expect(badge()).toBe('1');
  for (let line = 3; line < 14; line++) say({ line, from: 2, name: 'Maren', text: `line ${String(line)}` });
  expect(badge()).toBe('9+');
  expect(icon.getAttribute('aria-label')).toBe('Open chat, 12 new');
  // a tap on the icon opens the chat with the input focused, and clears the badge
  icon.click();
  expect(open(box)).toBe(true);
  expect(document.activeElement).toBe(field);
  expect(badge()).toBe('');
  // lines said while it is open are read there: no badge after it closes
  say({ line: 20, from: 2, name: 'Maren', text: 'see you' });
  outside();
  expect(open(box)).toBe(false);
  expect(badge()).toBe('');
});
