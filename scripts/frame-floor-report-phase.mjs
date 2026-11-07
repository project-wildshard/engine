/**
 * Boot is not the draw-budget measurement. Report-only readers enter at the
 * ordinary rate, then acknowledge the requested throttle and fence new draws.
 * Enforcing/profile callers keep their original boot throttle.
 * @param {number} rate
 * @param {boolean} postReady
 * @param {{apply:(rate:number)=>Promise<unknown>,fence:()=>Promise<{frame:number,atMs:number,firstCompletedFrame:number,documentOrigin:number}>}} ports
 */
export function frameFloorCpuPhase(rate, postReady, ports) {
  if (!Number.isInteger(rate) || rate < 1 || rate > 20) throw new Error('Invalid CPU phase rate');
  const bootRate = postReady ? 1 : rate;
  /** @type {{bootRate:number,requestedRate:number,measuredRate:number|null,fence:{frame:number,atMs:number,firstCompletedFrame:number,documentOrigin:number}|null}} */
  let state = { bootRate, requestedRate: rate, measuredRate: null, fence: null };
  let booted = false;
  return {
    boot: async () => { await ports.apply(bootRate); booted = true; },
    measure: async () => {
      if (!booted) throw new Error('CPU phase requires completed boot configuration');
      if (postReady && rate !== bootRate) {
        await ports.apply(rate);
        const fence = await ports.fence();
        if (!Number.isSafeInteger(fence.frame) || fence.frame < 0 || !Number.isSafeInteger(fence.firstCompletedFrame)
          || fence.firstCompletedFrame < fence.frame + 2 || !Number.isFinite(fence.atMs) || fence.atMs < 0
          || !Number.isFinite(fence.documentOrigin) || fence.documentOrigin <= 0) throw new Error('Invalid post-throttle draw fence');
        state = { ...state, measuredRate: rate, fence };
      } else state = { ...state, measuredRate: rate };
    },
    reading: () => ({ ...state, fence: state.fence === null ? null : { ...state.fence } }),
  };
}

/** Explicit software reporting never relaxes an official/enforcing Metal read.
 * @param {string} renderer
 * @param {{angle:string,explicit:boolean,reportOnly:boolean,platform:string}} policy
 */
export function assertFrameFloorRenderer(renderer, policy) {
  if (policy.angle === 'metal' && renderer.includes('ANGLE Metal Renderer')) return;
  if (policy.platform === 'linux' && policy.reportOnly && policy.explicit && policy.angle === 'swiftshader'
    && renderer.startsWith('ANGLE (') && renderer.includes('SwiftShader')) return;
  throw new Error(`Declared ${policy.angle} measurement backend refused: ${renderer}`);
}
