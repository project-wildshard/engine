// oxlint-disable-next-line import/no-nodejs-modules -- Shardfiles are addressed by their real hash.
import {createHash} from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- Each cook file runs the worker in folders of its own.
import {mkdtempSync, rmSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Each cook file runs the worker in folders of its own.
import {tmpdir} from 'node:os';
// oxlint-disable-next-line import/no-nodejs-modules -- Each cook file runs the worker in folders of its own.
import {join} from 'node:path';
import {afterAll, beforeAll} from 'vitest';
import {readTar} from '@wildshard/format/tar';
import {folderTarball} from '../../src/cook/game/folderTarball';
import {createCookWorker, type JobLauncher, type ShardfileSource} from '../../src/cook/game/cookWorker';
import {folderStore, type PackStore} from '../../src/cook/game/packStore';
import {compileCookWorker} from './compileCookWorker';

/** C4 (J28, J29, J30): the cook files share one setup. Each file still packs the real product, prepares the fixed child
 * entry and owns a fresh scratch folder, so no file depends on another's store, cache or order. */
export const root = process.cwd(), slug = 'sunscar-dunes';
export const hashOf = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** A ustar with one entry `writeTar` would never write, its checksum right, so only a reader's rules refuse it. */
export function rawTar(name: string, body: Uint8Array, type = '0'): Uint8Array {
  const header = new Uint8Array(512), put = (at: number, text: string): void => { header.set(new TextEncoder().encode(text), at); };
  put(0, name); put(100, '0000644\0'); put(108, '0000000\0'); put(116, '0000000\0'); put(124, `${body.length.toString(8).padStart(11, '0')}\0`); put(136, '00000000000\0');
  put(148, '        '); put(156, type); put(257, 'ustar\0'); put(263, '00');
  put(148, `${header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0')}\0 `);
  const padded = new Uint8Array(Math.ceil(body.length / 512) * 512); padded.set(body);
  const whole = new Uint8Array(512 + padded.length + 1024); whole.set(header); whole.set(padded, 512);
  return whole;
}

export interface CookHarness {
  readonly scratch: string;
  readonly real: Uint8Array;
  readonly files: ReadonlyMap<string, Uint8Array>;
  readonly store: PackStore;
  launcher: (script?: string, limits?: Partial<JobLauncher['limits']>) => JobLauncher;
  source: (blobs: ReadonlyMap<string, Uint8Array>) => ShardfileSource;
  worker: (blobs: ReadonlyMap<string, Uint8Array>, build?: string, folder?: string, budgetBytes?: number) => ReturnType<typeof createCookWorker>;
}

/** Register the original suite setup in the calling `describe`. */
export function useCookHarness(): CookHarness {
  let scratch: string | undefined, real: Uint8Array | undefined, files: Map<string, Uint8Array> | undefined, store: PackStore | undefined;
  let prepared: Awaited<ReturnType<typeof compileCookWorker>> | undefined, preparing: ReturnType<typeof compileCookWorker> | undefined;
  const preparationScope = new AbortController();
  const ready = <T>(value: T | undefined): T => { if (value === undefined) throw new Error('Cook preparation is missing'); return value; };
  const harness: CookHarness = {
    get scratch() { return ready(scratch); },
    get real() { return ready(real); },
    get files() { return ready(files); },
    get store() { return ready(store); },
    launcher: (script, limits = {}) => ({root, execPath: process.execPath, loader: join(root, 'scripts/bake-loader.mjs'), get script() { return script ?? ready(prepared).script; }, wrap: [], limits: {seconds: 120, memoryMB: 4096, heapMB: 2048, ...limits}}),
    source: blobs => ({
      heads: () => Promise.resolve([...blobs].map(([hash], row) => ({slug, revision: row + 1, hash}))),
      download: hash => { const bytes = blobs.get(hash); if (bytes === undefined) throw new Error('No such shardfile'); return Promise.resolve(bytes); },
    }),
    worker: (blobs, build = 'b1', folder = 'store', budgetBytes) => createCookWorker({build, store: folderStore(join(harness.scratch, folder)), source: harness.source(blobs), launcher: harness.launcher(), serverPacks: join(harness.scratch, 'server'), scratch: join(harness.scratch, 'work'), ...(budgetBytes === undefined ? {} : {budgetBytes})}),
  };
  beforeAll(async () => {
    scratch = mkdtempSync(join(tmpdir(), 'cook-worker-'));
    real = folderTarball(join('out', slug)); files = new Map(readTar(real)); store = folderStore(join(scratch, 'store'));
    preparing = compileCookWorker(preparationScope.signal); prepared = await preparing;
  });
  afterAll(async () => { preparationScope.abort(); await preparing?.catch(() => undefined); prepared?.dispose(); if (scratch !== undefined) rmSync(scratch, {recursive: true, force: true}); });
  return harness;
}
