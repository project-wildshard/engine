// ENGINE-MEMORY EM25 (design rule 4): the recorder T1's phone world installs on the page and in each worker logs every
// message whose untransferred buffers reach 64 KB, and never changes what is posted.
import { afterEach, expect, test } from 'vitest';
import { CLONE_LIMIT_BYTES, recordClones } from '../src/scripts/memory/cloneRecorder.mjs';

interface Row { readonly target: string; readonly bytes: number; readonly buffers: number }
const saved = { Worker: Reflect.get(globalThis, 'Worker'), MessagePort: Reflect.get(globalThis, 'MessagePort') };
afterEach(() => {
  Reflect.set(globalThis, 'Worker', saved.Worker); Reflect.set(globalThis, 'MessagePort', saved.MessagePort);
  Reflect.deleteProperty(globalThis, '__cloneLog'); Reflect.deleteProperty(globalThis, '__cloneSeen');
});

test('a message cloning 64 KB or more is logged; transferred, shared and small buffers are not', () => {
  const posted: unknown[][] = [];
  class FakeWorker { postMessage(...args: unknown[]): void { posted.push(args); } }
  class FakePort { postMessage(...args: unknown[]): void { posted.push(args); } }
  Reflect.set(globalThis, 'Worker', FakeWorker); Reflect.set(globalThis, 'MessagePort', FakePort);
  recordClones();
  const worker = new FakeWorker(), port = new FakePort();
  const big = new ArrayBuffer(CLONE_LIMIT_BYTES), small = new Uint8Array(1024);
  worker.postMessage({ bytes: new Float32Array(big) }); // cloned: logged
  worker.postMessage({ bytes: new Float32Array(big) }, [big]); // transferred
  const moved = new ArrayBuffer(CLONE_LIMIT_BYTES);
  port.postMessage({ rows: [new Uint8Array(moved), small] }, { transfer: [moved] }); // the small one alone clones
  port.postMessage(new Map([['a', new Uint8Array(CLONE_LIMIT_BYTES / 2)], ['b', new Uint8Array(CLONE_LIMIT_BYTES / 2)]])); // two halves: logged
  worker.postMessage({ shared: new Uint8Array(new SharedArrayBuffer(CLONE_LIMIT_BYTES)) }); // shared, not copied
  const log = Reflect.get(globalThis, '__cloneLog') as Row[];
  expect(log.map(row => [row.target, row.bytes, row.buffers])).toEqual([['Worker', CLONE_LIMIT_BYTES, 1], ['MessagePort', CLONE_LIMIT_BYTES, 2]]);
  expect(Reflect.get(globalThis, '__cloneSeen')).toEqual({ messages: 5, bytes: CLONE_LIMIT_BYTES * 2 + 1024 });
  expect(posted).toHaveLength(5);
  expect(posted[1]?.[1]).toEqual([big]);
});
