import {expect, test, vi} from 'vitest';
import {frameFloorCpuPhase, assertFrameFloorRenderer} from '../scripts/frame-floor-report-phase.mjs';
import {frameFloorChromiumAngle} from '../scripts/frame-floor-args.mjs';

const fence = {frame: 10, atMs: 100, firstCompletedFrame: 12, documentOrigin: 1000};

test('reporting waits for 4x acknowledgement and new completed draws after ordinary boot', async () => {
  const events: string[] = []; let acknowledge = (): void => undefined;
  const pending = new Promise<void>(resolve => { acknowledge = resolve; });
  const phase = frameFloorCpuPhase(4, true, {
    apply: async rate => { events.push(`apply:${String(rate)}`); if (rate === 4) await pending; },
    fence: () => { events.push('fence'); return Promise.resolve(fence); },
  });
  await phase.boot(); expect(events).toEqual(['apply:1']);
  const measured = phase.measure(); await Promise.resolve();
  expect(events).toEqual(['apply:1', 'apply:4']); expect(phase.reading().measuredRate).toBeNull();
  acknowledge(); await measured;
  expect(events).toEqual(['apply:1', 'apply:4', 'fence']);
  expect(phase.reading()).toEqual({bootRate: 1, requestedRate: 4, measuredRate: 4, fence});
  const detached = phase.reading(); if (detached.fence !== null) detached.fence.frame = -1;
  expect(phase.reading().fence).toEqual(fence);
});

test('enforcing/profile boot retains its throttle and never uses the report-only fence', async () => {
  const apply = vi.fn<(rate: number) => Promise<void>>().mockResolvedValue(undefined);
  const after = vi.fn<() => Promise<typeof fence>>().mockResolvedValue(fence);
  const phase = frameFloorCpuPhase(4, false, {apply, fence: after});
  await phase.boot(); await phase.measure();
  expect(apply.mock.calls).toEqual([[4]]); expect(after).not.toHaveBeenCalled();
  expect(phase.reading()).toEqual({bootRate: 4, requestedRate: 4, measuredRate: 4, fence: null});
});

test('failed throttle, missing boot and invalid draw fences refuse measurement credit', async () => {
  const refusal = new Error('CDP refused');
  const phase = frameFloorCpuPhase(4, true, {apply: rate => rate === 4 ? Promise.reject(refusal) : Promise.resolve(), fence: () => Promise.resolve(fence)});
  await expect(phase.measure()).rejects.toThrow('completed boot');
  await phase.boot(); await expect(phase.measure()).rejects.toBe(refusal); expect(phase.reading().measuredRate).toBeNull();
  for (const invalid of [{...fence, firstCompletedFrame: 11}, {...fence, frame: -1}, {...fence, atMs: Number.NaN}, {...fence, documentOrigin: 0}]) {
    const bad = frameFloorCpuPhase(4, true, {apply: () => Promise.resolve(), fence: () => Promise.resolve(invalid)});
    await bad.boot(); await expect(bad.measure()).rejects.toThrow('draw fence'); expect(bad.reading().measuredRate).toBeNull();
  }
});

test('only explicitly declared Linux report-only SwiftShader admits software rendering', () => {
  const args = ['--surface=desktop', '--chromium-phone', '--chromium-cpu=4', '--draw-budget-report-only', '--chromium-angle=swiftshader'];
  expect(frameFloorChromiumAngle(args, 'linux')).toEqual({angle: 'swiftshader', explicit: true});
  const software = 'ANGLE (Google, Vulkan 1.3 (SwiftShader Device), SwiftShader driver)';
  const policy = {angle: 'swiftshader', explicit: true, reportOnly: true, platform: 'linux'};
  expect(() => assertFrameFloorRenderer(software, policy)).not.toThrow();
  for (const wrong of [{...policy, explicit: false}, {...policy, reportOnly: false}, {...policy, platform: 'darwin'}])
    expect(() => assertFrameFloorRenderer(software, wrong)).toThrow('backend refused');
  expect(() => assertFrameFloorRenderer('Unrelated SwiftShader', policy)).toThrow('backend refused');
  expect(() => assertFrameFloorRenderer('ANGLE Metal Renderer: Apple', {...policy, angle: 'metal', reportOnly: false})).not.toThrow();
  expect(() => frameFloorChromiumAngle(args, 'darwin')).toThrow('Linux report-only');
  expect(() => frameFloorChromiumAngle([...args, '--chromium-angle=metal'], 'linux')).toThrow('Unknown');
  expect(() => frameFloorChromiumAngle(args.filter(arg => arg !== '--draw-budget-report-only'), 'linux')).toThrow('Linux report-only');
});
