/** Wait for startup toasts to finish before reading the complete HUD structure.
 * Timer-only capture ticks leave the gameplay frame gate closed.
 * @param {number} timerHz */
export async function waitForToastIdle(timerHz) {
  const control = window.__parity;
  const live = () => document.querySelector('.ws-game-toast') !== null;
  if (control.wait) {
    for (let tick = 0; live() && tick < 10 * timerHz; tick++) await control.wait(1);
  } else {
    const deadline = performance.now() + 10_000;
    while (live() && performance.now() < deadline) {
      await new Promise((resolve) => { control.rawRAF(() => { resolve(undefined); }); });
    }
  }
  if (live()) throw new Error('infrastructure: startup toast did not become idle within 10 seconds');
  return window.__wildshard.fingerprint().hud;
}
