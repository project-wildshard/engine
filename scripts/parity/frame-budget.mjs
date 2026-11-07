/** Bind a capture budget to completed draws, never to frameGate queries.
 * @param {{frameCount:number,frameGate:()=>boolean}} game
 * @param {{remaining:number,free:boolean,advance:(frames:number)=>Promise<void>}} control
 * @param {(run:FrameRequestCallback)=>number} requestFrame
 * @param {(id:number)=>void} cancelFrame
 * @returns {()=>void} */
export function bindFrameBudget(game, control, requestFrame, cancelFrame) {
  const original = game.frameGate.bind(game);
  let target = game.frameCount, retired = false, advancing = false, raf = 0;
  /** @type {((reason:Error)=>void)|undefined} */
  let rejectPending;
  Object.defineProperty(control, 'remaining', { configurable: true,
    get: () => Math.max(0, target - game.frameCount),
    set: frames => { if (!Number.isInteger(frames) || frames < 0) throw new Error('Invalid frame budget'); target = game.frameCount + frames; },
  });
  game.frameGate = () => original() && (control.free || control.remaining > 0);
  control.advance = async frames => {
    if (retired) throw new Error('Parity level retired');
    if (!Number.isInteger(frames) || frames < 0 || advancing || control.free) throw new Error('Invalid concurrent frame advance');
    if (frames === 0) return;
    advancing = true; control.remaining = frames;
    try {
      await new Promise((resolve, reject) => {
        rejectPending = reject;
        const check = () => {
          if (control.remaining === 0) { resolve(undefined); return; }
          raf = requestFrame(check);
        };
        raf = requestFrame(check);
      });
    } finally { advancing = false; rejectPending = undefined; }
  };
  return () => {
    retired = true; cancelFrame(raf); rejectPending?.(new Error('Parity level retired'));
    game.frameGate = original;
    Object.defineProperty(control, 'remaining', { value: 0, configurable: true, writable: true });
    control.advance = () => Promise.reject(new Error('Parity level retired'));
  };
}
