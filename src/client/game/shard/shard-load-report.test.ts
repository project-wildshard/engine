// @vitest-environment happy-dom
// QA 11-25 row 133: a shard load that fails reports the boot's last checkpoints, so a GPU fault in the load (a shader
// compile, a texture upload) names the operation it died in, as the fatal card's report does.
import { beforeEach, expect, test, vi } from 'vitest';
import { recordBootCheckpoint, startBoot } from '@wildshard/engine/boot/bootTrace';
import { saveStorage } from '@wildshard/engine/saves/slots';
import { SHARD_API } from '../../../shared/game/shard/api';
import { runShardLoad, type ShardLoadFailure } from './load';

beforeEach(() => { localStorage.clear(); saveStorage('device').removeItem('boot.trace'); vi.stubGlobal('__BUILD_ID__', 'test-build'); });

test('a failed shard load reports the boot checkpoint it stopped at, in its context and its tags', async () => {
  startBoot({ id: 'nine-dragon-stack', name: 'Nine Dragon Stack' });
  recordBootCheckpoint('compile:before');
  const reported: ShardLoadFailure[] = [];
  const shown: ShardLoadFailure[] = [];
  const fault = new TypeError("Argument 1 ('shader') to WebGL2RenderingContext.shaderSource must be an instance of WebGLShader");
  await expect(runShardLoad({ api: SHARD_API, slug: 'nine-dragon-stack', name: 'Nine Dragon Stack' }, () => Promise.reject(fault), {
    build: 'test-build', dispose: () => undefined,
    report: (failure) => { reported.push(failure as ShardLoadFailure); return Promise.resolve('sent'); },
    show: (failure) => { shown.push(failure as ShardLoadFailure); },
  })).rejects.toBe(fault);
  expect(reported).toHaveLength(1);
  expect(shown).toHaveLength(1);
  const [failure] = reported;
  expect(String(failure?.context['bootDiagnostic'])).toContain('compile:before');
  expect(JSON.stringify(failure?.tags.diagnostic)).toContain('compile:before');
});
