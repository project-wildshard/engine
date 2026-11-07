import {expect, test} from 'vitest';
import {Scope} from '../../../shared/engine/app/scope';
import {nativeRetired} from '../render/precompile';
import {issueBakedPrograms, queueBakedPrograms, releaseBakedPrograms, type BakedPrograms} from './earlyPrograms';

/** Just enough of a WebGL2 context for the baked pass: every object it creates, and which of them were deleted. */
class FakeGL {
  readonly VERTEX_SHADER = 0x8b31; readonly FRAGMENT_SHADER = 0x8b30;
  readonly made: object[] = []; readonly deleted = new Set<object>();
  createShader(): object { const s = {}; this.made.push(s); return s; }
  createProgram(): object { const p = {}; this.made.push(p); return p; }
  calls = 0;
  shaderSource(): void { this.calls++; } compileShader(): void { this.calls++; } attachShader(): void { this.calls++; } linkProgram(): void { this.calls++; }
  deleteProgram(p: object): void { this.deleted.add(p); } deleteShader(s: object): void { this.deleted.add(s); }
  isContextLost(): boolean { return false; } getExtension(): null { return null; }
}
const LIST: BakedPrograms = { version: 2, lines: ['void main() {}'], shaders: [[0], [0]], programs: [[0, 1]] };
const settle = async (): Promise<void> => { for (let i = 0; i < 5; i++) await new Promise(resolve => { setTimeout(resolve, 0); }); };

// CI's WebKit road journey on fa1da6a58c: a level's dispose released whichever baked pass was current, so the old level
// deleted the next level's programs while that pass still polled them (deleted-object warnings, a poll that never ends)
test('a level disposing releases only its own baked pass, not the next level\'s', async () => {
  const realGL = Reflect.get(globalThis, 'WebGL2RenderingContext');
  Reflect.set(globalThis, 'WebGL2RenderingContext', FakeGL);
  try {
    const gl = new FakeGL(), first = new Scope('level-a'), second = new Scope('level-b');
    const game = (levelScope: Scope): Parameters<typeof issueBakedPrograms>[0] => ({ renderer: { getContext: () => gl }, levelScope });
    queueBakedPrograms(Promise.resolve(LIST)); issueBakedPrograms(game(first)); await settle();
    const firstObjects = [...gl.made];
    queueBakedPrograms(Promise.resolve(LIST)); issueBakedPrograms(game(second)); await settle();
    const secondObjects = gl.made.slice(firstObjects.length);
    expect(firstObjects.length).toBe(3); expect(secondObjects.length).toBe(3);
    first.dispose();
    expect(firstObjects.every(o => gl.deleted.has(o))).toBe(true);
    expect(secondObjects.some(o => gl.deleted.has(o))).toBe(false);
    second.dispose();
    expect(secondObjects.every(o => gl.deleted.has(o))).toBe(true);
  } finally {
    Reflect.set(globalThis, 'WebGL2RenderingContext', realGL);
  }
});

// sp-x2's review gap: the paced branch (WebKit, KHR_parallel_shader_compile) polls each link's COMPLETION_STATUS once a
// painted frame. Released while its level still lives (the first frame is drawn), it must never ask about its deleted
// programs again; a disposed level's cancelled frames stop it anyway.
test('a released WebKit pass stops polling its deleted programs', async () => {
  const realGL = Reflect.get(globalThis, 'WebGL2RenderingContext'), agent = Object.getOwnPropertyDescriptor(navigator, 'userAgent');
  Reflect.set(globalThis, 'WebGL2RenderingContext', FakeGL);
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Version/18.0 Mobile Safari' });
  // a frame clock for the pass's once-a-painted-frame poll (Node has none)
  const realRaf = Reflect.get(globalThis, 'requestAnimationFrame'), realCancel = Reflect.get(globalThis, 'cancelAnimationFrame');
  Reflect.set(globalThis, 'requestAnimationFrame', (run: (t: number) => void) => setTimeout(() => { run(performance.now()); }, 0));
  Reflect.set(globalThis, 'cancelAnimationFrame', (id: ReturnType<typeof setTimeout>) => { clearTimeout(id); });
  try {
    const asked: object[] = [];
    class PacedGL extends FakeGL {
      override getExtension(): null { return null; }
      readonly parallel = { COMPLETION_STATUS_KHR: 0x91b1 };
      // links never complete, so the pass keeps polling until something stops it
      getProgramParameter(program: object): boolean { asked.push(program); return false; }
    }
    Reflect.set(globalThis, 'WebGL2RenderingContext', PacedGL);
    const gl = new PacedGL(), level = new Scope('level');
    Reflect.set(gl, 'getExtension', () => gl.parallel);
    const game = (levelScope: Scope): Parameters<typeof issueBakedPrograms>[0] => ({ renderer: { getContext: () => gl }, levelScope });
    queueBakedPrograms(Promise.resolve(LIST)); issueBakedPrograms(game(level)); await settle();
    expect(asked.length).toBeGreaterThan(0); // it is polling the first link
    releaseBakedPrograms();
    const before = asked.length; await settle();
    expect(asked.length).toBe(before); // released: no query of a deleted program
    level.dispose();
  } finally {
    Reflect.set(globalThis, 'WebGL2RenderingContext', realGL);
    Reflect.set(globalThis, 'requestAnimationFrame', realRaf); Reflect.set(globalThis, 'cancelAnimationFrame', realCancel);
    if (agent === undefined) Reflect.deleteProperty(navigator, 'userAgent'); else Object.defineProperty(navigator, 'userAgent', agent);
  }
});

// DL21: the pass runs to the end of its list (the tail is the spawn view's tiles' programs) and, paced, releases itself once
// every link has completed: nothing stops it at the Shaders step any more
test('a paced pass links its whole list, then releases itself with its level still alive', async () => {
  const realGL = Reflect.get(globalThis, 'WebGL2RenderingContext'), agent = Object.getOwnPropertyDescriptor(navigator, 'userAgent');
  const realRaf = Reflect.get(globalThis, 'requestAnimationFrame'), realCancel = Reflect.get(globalThis, 'cancelAnimationFrame');
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Version/18.0 Mobile Safari' });
  Reflect.set(globalThis, 'requestAnimationFrame', (run: (t: number) => void) => setTimeout(() => { run(performance.now()); }, 0));
  Reflect.set(globalThis, 'cancelAnimationFrame', (id: ReturnType<typeof setTimeout>) => { clearTimeout(id); });
  class DoneGL extends FakeGL { getProgramParameter(): boolean { return true; } } // every link completes at once
  Reflect.set(globalThis, 'WebGL2RenderingContext', DoneGL);
  try {
    const gl = new DoneGL(), level = new Scope('level');
    Reflect.set(gl, 'getExtension', () => ({ COMPLETION_STATUS_KHR: 0x91b1 }));
    const two: BakedPrograms = { version: 2, lines: ['void main() {}'], shaders: [[0], [0]], programs: [[0, 1], [1, 0]] };
    queueBakedPrograms(Promise.resolve(two));
    issueBakedPrograms({ renderer: { getContext: () => gl }, levelScope: level }); await settle();
    expect(gl.made.length).toBe(4); // two shaders, both programs linked
    expect(gl.made.every(o => gl.deleted.has(o))).toBe(true); // released with the level still alive
    level.dispose();
  } finally {
    Reflect.set(globalThis, 'WebGL2RenderingContext', realGL);
    Reflect.set(globalThis, 'requestAnimationFrame', realRaf); Reflect.set(globalThis, 'cancelAnimationFrame', realCancel);
    if (agent === undefined) Reflect.deleteProperty(navigator, 'userAgent'); else Object.defineProperty(navigator, 'userAgent', agent);
  }
});

// three's WebGLProgram.destroy() deletes the native program and leaves `.program` undefined: such an identity is settled
test('a program three destroyed reads as retired; a live one does not', () => {
  expect(nativeRetired({ program: undefined })).toBe(true);
  expect(nativeRetired({ program: null })).toBe(true);
  expect(nativeRetired({ program: {} })).toBe(false);
  expect(nativeRetired({ isReady: () => true })).toBe(false); // no `program` key: not a three program at all
});

// sp-x8's C25: the baked entry list is optional. A read that fails before the renderer step reaches it (offline, an HTML
// fallback page that is not JSON) must settle as "no list", never as an unhandled rejection: the page turns those into
// a boot failure.
test('a baked list that rejects before the renderer step is no list, not an unhandled rejection', async () => {
  const unhandled: unknown[] = [], record = (reason: unknown): void => { unhandled.push(reason); };
  process.on('unhandledRejection', record);
  try {
    queueBakedPrograms(Promise.reject(new Error('offline')));
    // two macrotasks: Node reports an unhandled rejection after the microtask queue drains
    await new Promise(resolve => { setTimeout(resolve, 0); });
    await new Promise(resolve => { setTimeout(resolve, 0); });
    expect(unhandled).toEqual([]);
  } finally {
    process.off('unhandledRejection', record);
  }
});
