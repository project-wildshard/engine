// No sound from agent browsers, ever (meta QA-FEEDBACK-2026-11-24 row 49; Jake, 2026-11-24 ~16:50 Cancún: "NEVER
// FUCKING SOUND SOUND OFF", after a lane's iOS Simulator played game audio on his speakers). Every browser the marked
// helper (browser-playwright.mjs) starts carries the agent marker, so it is silenced twice over:
//   - a Chromium start always passes --mute-audio, whatever args the caller gave;
//   - every context and page, in Chromium, WebKit and Firefox alike, runs `silencePage` before the page's own script:
//     Web Audio plays into a zero gain in front of the real speakers, and every media element is muted.
// WebKit and Firefox have no mute switch, so the page side is what keeps them quiet.

export const MUTE_ARG = '--mute-audio';

/** Runs inside the page, before its own script; it must not close over anything. Web Audio keeps its clock and graph
 * (a game that waits on `currentTime` or a `running` state behaves as for a player), but `destination` is a gain of 0
 * wired to the real speakers. Media elements are muted on play and cannot be unmuted. */
export function silencePage() {
  const scope = /** @type {any} */ (globalThis);
  const base = scope.BaseAudioContext?.prototype ?? scope.AudioContext?.prototype ?? scope.webkitAudioContext?.prototype;
  const real = base === undefined ? undefined : Object.getOwnPropertyDescriptor(base, 'destination')?.get;
  if (real !== undefined && base.__wildshardSilenced !== true) {
    const sinks = new WeakMap();
    Object.defineProperty(base, '__wildshardSilenced', { value: true });
    Object.defineProperty(base, 'destination', {
      configurable: true,
      enumerable: true,
      get() {
        const speakers = real.call(this);
        // Rendering to a buffer makes no sound, and the buffer must keep what was rendered.
        if (scope.OfflineAudioContext !== undefined && this instanceof scope.OfflineAudioContext) return speakers;
        let sink = sinks.get(this);
        if (sink === undefined) {
          sink = this.createGain();
          sink.gain.value = 0;
          sink.connect(speakers);
          sinks.set(this, sink);
        }
        return sink;
      },
    });
  }
  const media = scope.HTMLMediaElement?.prototype;
  const muted = media === undefined ? undefined : Object.getOwnPropertyDescriptor(media, 'muted');
  if (media !== undefined && muted?.set !== undefined && media.__wildshardSilenced !== true) {
    const mute = (/** @type {unknown} */ element) => muted.set?.call(element, true);
    Object.defineProperty(media, '__wildshardSilenced', { value: true });
    Object.defineProperty(media, 'muted', { configurable: true, enumerable: true, get: muted.get, set() { mute(this); } });
    const play = media.play;
    media.play = function silentPlay(/** @type {unknown[]} */ ...args) {
      mute(this);
      return play.apply(this, args);
    };
    // An autoplay element starts without a play() call.
    scope.addEventListener?.('play', (/** @type {Event} */ event) => mute(event.target), true);
  }
}

/** Silence a context or page before its own script runs; anything without `addInitScript` passes through.
 * @template T @param {T} target @returns {Promise<T>} */
export async function silenced(target) {
  const own = /** @type {{ addInitScript?: (script: () => void) => Promise<void> } | null | undefined} */ (target);
  if (typeof own?.addInitScript === 'function') await own.addInitScript(silencePage);
  return target;
}

/** Launch options for a Chromium start, with --mute-audio added when the caller left it out.
 * @template {{ args?: string[] }} Options @param {Options | undefined} options @returns {Options} */
export function mutedLaunch(options) {
  const args = options?.args ?? [];
  return /** @type {Options} */ ({ ...options, args: args.includes(MUTE_ARG) ? args : [...args, MUTE_ARG] });
}
