// @vitest-environment happy-dom
import { expect, test, vi } from 'vitest';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import * as gpuFiles from './gpuFiles';
import { initializeTier, TIER } from '../core/tier';
import type { Renderer } from '../render/renderer';
import { initKtx2 } from '../core/ktx2';

class Transcoder extends EventTarget implements Worker {
  onerror: Worker['onerror'] = null;
  onmessage: Worker['onmessage'] = null;
  onmessageerror: Worker['onmessageerror'] = null;
  readonly messages: unknown[] = [];
  readonly terminate = vi.fn<Worker['terminate']>();
  postMessage(message: unknown): void { this.messages.push(message); }
  reply(value: unknown): void { this.dispatchEvent(new MessageEvent('message', { data: value })); }
}

test('phone KTX2 textures share one real transcode worker and drain queued jobs', async () => {
  const tier = TIER;
  let captured: KTX2Loader | undefined;
  const detect = vi.spyOn(KTX2Loader.prototype, 'detectSupport').mockImplementation(function detectSupport(this: KTX2Loader) {
    this.workerConfig = { astcSupported: false, astcHDRSupported: false, etc1Supported: false, etc2Supported: false, dxtSupported: false, bptcSupported: false, pvrtcSupported: false };
    return this;
  });
  const init = vi.spyOn(KTX2Loader.prototype, 'init').mockResolvedValue(undefined);
  const mode = vi.spyOn(gpuFiles, 'texMode').mockReturnValue('ktx2');
  try {
    initializeTier('phone');
    initKtx2({} as Renderer);
    const detected = detect.mock.contexts[0];
    if (!(detected instanceof KTX2Loader)) throw new Error('KTX2 did not detect its renderer');
    captured = detected;
    const pool = captured.workerPool, workers: Transcoder[] = [];
    pool.setWorkerCreator(() => { const worker = new Transcoder(); workers.push(worker); return worker; });
    const first = pool.postMessage({ job: 1 }, []), second = pool.postMessage({ job: 2 }, []);
    expect(workers).toHaveLength(1);
    expect(workers[0]?.messages).toEqual([{ job: 1 }]);
    workers[0]?.reply({ result: 1 });
    expect((await first).data).toEqual({ result: 1 });
    expect(workers).toHaveLength(1);
    expect(workers[0]?.messages).toEqual([{ job: 1 }, { job: 2 }]);
    workers[0]?.reply({ result: 2 });
    expect((await second).data).toEqual({ result: 2 });
  } finally { captured?.dispose(); detect.mockRestore(); init.mockRestore(); mode.mockRestore(); initializeTier(tier); }
});
