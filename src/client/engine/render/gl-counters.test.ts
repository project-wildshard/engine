import { expect, test } from 'vitest';
import { MemoryAttribution } from '../../../shared/engine/core/memoryAttribution';
import { installAllocationJournal } from './allocationJournal';
import { GlCounters, installMemoryCounters, memoryCounters, publishMemoryCounters } from './glCounters';

// ENGINE-MEMORY EM5: the counters journal is on every page. A fake context keeps WebGL's binding state (the journal reads
// the binding a storage call targets) and its drawing-buffer size.
class FakeGl {
  readonly canvas = new EventTarget();
  drawingBufferWidth = 100;
  drawingBufferHeight = 50;
  private texture: object | null = null;
  private buffer: object | null = null;
  private renderbuffer: object | null = null;
  createTexture(): object { return {}; }
  createBuffer(): object { return {}; }
  createRenderbuffer(): object { return {}; }
  bindTexture(_target: number, texture: object | null): void { this.texture = texture; }
  bindBuffer(_target: number, buffer: object | null): void { this.buffer = buffer; }
  bindRenderbuffer(_target: number, renderbuffer: object | null): void { this.renderbuffer = renderbuffer; }
  getParameter(pname: number): unknown {
    if (pname === 0x8069) return this.texture;
    if (pname === 0x8894) return this.buffer;
    if (pname === 0x8ca7) return this.renderbuffer;
    return null;
  }
  texImage2D(..._args: unknown[]): void { /* storage */ }
  texStorage2D(..._args: unknown[]): void { /* storage */ }
  compressedTexImage2D(..._args: unknown[]): void { /* storage */ }
  bufferData(..._args: unknown[]): void { /* storage */ }
  renderbufferStorage(..._args: unknown[]): void { /* storage */ }
  renderbufferStorageMultisample(..._args: unknown[]): void { /* storage */ }
  deleteTexture(_texture: object): void { /* release */ }
  deleteBuffer(_buffer: object): void { /* release */ }
  deleteRenderbuffer(_renderbuffer: object): void { /* release */ }
}
const RGBA8 = 0x8058, ASTC_4x4 = 0x93b0, DEPTH16 = 0x81a5;

test('every kind is counted exactly on create, resize and delete, with its format and the drawing buffer', () => {
  const gl = new FakeGl(), counters = new GlCounters();
  const stop = installMemoryCounters(gl, counters);
  try {
    expect(counters.kinds()).toEqual({ 'drawing-buffer': 100 * 50 * 8 });
    const texture = gl.createTexture(); gl.bindTexture(0x0de1, texture);
    gl.texImage2D(0x0de1, 0, RGBA8, 64, 32, 0, 0x1908, 0x1401, null);
    const astc = gl.createTexture(); gl.bindTexture(0x0de1, astc);
    gl.compressedTexImage2D(0x0de1, 0, ASTC_4x4, 64, 64, 0, new Uint8Array(4096));
    const buffer = gl.createBuffer(); gl.bindBuffer(0x8892, buffer); gl.bufferData(0x8892, 1000, 0x88e4);
    const depth = gl.createRenderbuffer(); gl.bindRenderbuffer(0x8d41, depth); gl.renderbufferStorage(0x8d41, DEPTH16, 16, 16);
    const msaa = gl.createRenderbuffer(); gl.bindRenderbuffer(0x8d41, msaa); gl.renderbufferStorageMultisample(0x8d41, 4, RGBA8, 8, 8);
    expect(counters.detail()).toEqual({
      kinds: { texture: 64 * 32 * 4 + 4096, buffer: 1000, renderbuffer: 16 * 16 * 2 + 8 * 8 * 4 * 4, 'drawing-buffer': 40_000 },
      formats: { '0x8058': 64 * 32 * 4 + 8 * 8 * 4 * 4, '0x93b0': 4096, buffer: 1000, '0x81a5': 512 },
      owners: { unattributed: 64 * 32 * 4 + 4096 + 1000 + 512 + 1024 },
    });
    // resize: the texture's level 0 grows, the buffer shrinks, the canvas grows
    gl.bindTexture(0x0de1, texture); gl.texImage2D(0x0de1, 0, RGBA8, 128, 128, 0, 0x1908, 0x1401, null);
    gl.bindBuffer(0x8892, buffer); gl.bufferData(0x8892, 10, 0x88e4);
    gl.drawingBufferWidth = 200;
    expect(counters.kinds()).toEqual({ texture: 128 * 128 * 4 + 4096, buffer: 10, renderbuffer: 1536, 'drawing-buffer': 80_000 });
    // delete
    gl.deleteTexture(texture); gl.deleteTexture(astc); gl.deleteBuffer(buffer); gl.deleteRenderbuffer(depth); gl.deleteRenderbuffer(msaa);
    expect(counters.detail()).toEqual({ kinds: { 'drawing-buffer': 80_000 }, formats: {}, owners: {} });
    expect(counters.total()).toBe(80_000);
  } finally { stop(); }
});

test("an owner label moves a resource's bytes; Developer's journal stacks on the counters and leaves them installed", () => {
  const gl = new FakeGl(), counters = new GlCounters(), ledger = new MemoryAttribution();
  const stopCounters = installMemoryCounters(gl, counters);
  const buffer = gl.createBuffer(); gl.bindBuffer(0x8892, buffer); gl.bufferData(0x8892, 64, 0x88e4);
  counters.label(buffer, { owner: 'engine/sky', asset: 'dome' });
  expect(counters.detail().owners).toEqual({ 'engine/sky': 64 });
  const stopDeveloper = installAllocationJournal(gl, ledger);
  expect(installAllocationJournal(gl, ledger)).toBe(stopDeveloper);
  const late = gl.createBuffer(); gl.bindBuffer(0x8892, late); gl.bufferData(0x8892, 32, 0x88e4);
  expect(ledger.summary().totals.gpu).toBe(32);
  expect(counters.kinds()['buffer']).toBe(96);
  stopDeveloper();
  expect(ledger.summary().totals.gpu).toBe(0);
  gl.bufferData(0x8892, 48, 0x88e4);
  expect(counters.kinds()['buffer']).toBe(64 + 48);
  expect(Object.hasOwn(gl, 'bufferData')).toBe(true);
  stopCounters();
  expect(Object.hasOwn(gl, 'bufferData')).toBe(false);
});

test('the harness read-out names GPU and RAM kinds', () => {
  publishMemoryCounters();
  const hook: unknown = Reflect.get(globalThis, '__wildshardMemory');
  expect(typeof Reflect.get(hook as object, 'counters')).toBe('function');
  const read = memoryCounters();
  expect(Object.keys(read).sort()).toEqual(['gpu', 'ram']);
});
