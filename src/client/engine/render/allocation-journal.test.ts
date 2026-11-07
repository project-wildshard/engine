import { expect, test } from 'vitest';
import { MemoryAttribution } from '../../../shared/engine/core/memoryAttribution';
import { installAllocationJournal } from './allocationJournal';

// PF3 / P4: the journal reads the binding a storage call targets from the context's binding state at that call, and wraps
// no bind (the bind wrappers ran on every draw). A fake context keeps WebGL's binding state: textures per unit and target,
// buffers per target with the element array binding held by the bound vertex array, and the bound renderbuffer.
class FakeGl {
  readonly canvas = new EventTarget();
  private unit = 0;
  private readonly textures = new Map<string, object | null>();
  private readonly buffers = new Map<number, object | null>();
  private readonly arrays = new Map<object, object | null>();
  private array: object | null = null;
  private defaultElements: object | null = null;
  private renderbuffer: object | null = null;
  createTexture(): object { return {}; }
  createBuffer(): object { return {}; }
  createRenderbuffer(): object { return {}; }
  createVertexArray(): object { return {}; }
  activeTexture(unit: number): void { this.unit = unit - 0x84c0; }
  bindTexture(target: number, texture: object | null): void { this.textures.set(`${this.unit}:${target}`, texture); }
  bindBuffer(target: number, buffer: object | null): void {
    if (target !== 0x8893) { this.buffers.set(target, buffer); return; }
    if (this.array === null) this.defaultElements = buffer; else this.arrays.set(this.array, buffer);
  }
  bindVertexArray(array: object | null): void { this.array = array; }
  bindRenderbuffer(_target: number, renderbuffer: object | null): void { this.renderbuffer = renderbuffer; }
  getParameter(pname: number): unknown {
    const texture = (target: number): unknown => this.textures.get(`${this.unit}:${target}`) ?? null;
    if (pname === 0x8069) return texture(0x0de1);
    if (pname === 0x8514) return texture(0x8513);
    if (pname === 0x8c1d) return texture(0x8c1a);
    if (pname === 0x8894) return this.buffers.get(0x8892) ?? null;
    if (pname === 0x8895) return this.array === null ? this.defaultElements : this.arrays.get(this.array) ?? null;
    if (pname === 0x8ca7) return this.renderbuffer;
    return null;
  }
  texImage2D(..._args: unknown[]): void { /* storage */ }
  texStorage2D(..._args: unknown[]): void { /* storage */ }
  texStorage3D(..._args: unknown[]): void { /* storage */ }
  bufferData(..._args: unknown[]): void { /* storage */ }
  renderbufferStorage(..._args: unknown[]): void { /* storage */ }
  deleteTexture(_texture: object): void { /* release */ }
}

test('storage calls are charged to the resource bound at that call; no bind is wrapped', () => {
  const gl = new FakeGl(), ledger = new MemoryAttribution();
  const stop = installAllocationJournal(gl, ledger);
  // a wrapped method is an own property of the context (the journal sets it there); the binds stay the prototype's
  const wrapped = (name: string): boolean => Object.hasOwn(gl, name);
  expect(['activeTexture', 'bindTexture', 'bindBuffer', 'bindVertexArray', 'bindRenderbuffer'].filter(wrapped)).toEqual([]);
  expect(wrapped('bufferData') && wrapped('texStorage2D')).toBe(true);
  // a 2D texture on unit 3 (64 × 32 RGBA8, one level) and a cube on unit 0 (16², 6 faces, RGBA8)
  const flat = gl.createTexture(), cube = gl.createTexture();
  gl.activeTexture(0x84c0 + 3); gl.bindTexture(0x0de1, flat); gl.texStorage2D(0x0de1, 1, 0x8058, 64, 32);
  gl.activeTexture(0x84c0); gl.bindTexture(0x8513, cube); gl.texStorage2D(0x8513, 1, 0x8058, 16, 16);
  // an array buffer, and an element buffer held by a vertex array that is unbound before its data
  const vertices = gl.createBuffer(), indices = gl.createBuffer(), vao = gl.createVertexArray();
  gl.bindBuffer(0x8892, vertices); gl.bufferData(0x8892, new Float32Array(100), 0x88e4);
  gl.bindVertexArray(vao); gl.bindBuffer(0x8893, indices); gl.bindVertexArray(null); gl.bindVertexArray(vao);
  gl.bufferData(0x8893, new Uint16Array(30), 0x88e4);
  const depth = gl.createRenderbuffer();
  gl.bindRenderbuffer(0x8d41, depth); gl.renderbufferStorage(0x8d41, 0x81a5, 8, 8);
  const bytes = (): number => ledger.summary().totals.gpu;
  expect(bytes()).toBe(64 * 32 * 4 + 16 * 16 * 4 * 6 + 400 + 60 + 8 * 8 * 2);
  gl.deleteTexture(flat);
  expect(bytes()).toBe(16 * 16 * 4 * 6 + 400 + 60 + 8 * 8 * 2);
  stop();
});
