import { rmSync, writeFileSync } from 'node:fs';

/** @type {WeakMap<object, {boundary:string, observation:unknown}[]>} */
const observations = new WeakMap();

/** Serialized by Playwright: retain only bounded copies, never audio graphs or level owners. */
export function sampleAudioBoundary() {
  const world = window.__wildshard.requireWorld();
  const audio = world.audio, music = world.music, app = world.game.app;
  const samples = audio.samples, state = music.state, scope = world.game.levelScope;
  const rng = app.rng.snapshot();
  const rawLog = /** @type {unknown} */ (Reflect.get(window, '__audioLog'));
  const log = Array.isArray(rawLog) ? rawLog.slice(-16).flatMap((/** @type {unknown} */ entry) => {
    if (entry === null || typeof entry !== 'object') return [];
    const t = /** @type {unknown} */ (Reflect.get(entry, 't'));
    const kind = /** @type {unknown} */ (Reflect.get(entry, 'kind'));
    const name = /** @type {unknown} */ (Reflect.get(entry, 'name'));
    const ok = /** @type {unknown} */ (Reflect.get(entry, 'ok'));
    const detail = /** @type {unknown} */ (Reflect.get(entry, 'detail'));
    if (typeof t !== 'number' || !Number.isFinite(t) || typeof kind !== 'string' || typeof name !== 'string') return [];
    return [{t, kind:kind.slice(0,32), name:name.slice(0,96), ok:typeof ok === 'boolean' ? ok : null,
      detail:typeof detail === 'string' ? detail.slice(0,160) : null}];
  }) : [];
  const census = scope.census, mixerCensus = audio.census();
  return {
    graphReady:audio.ready, muted:audio.muted, worldMuted:audio.worldMuted,
    mixer:{set:samples.set, loopCount:samples.loops.length, shotCount:samples.oneshots.length,
      loops:samples.loops.slice(0,16).map(name => name.slice(0,96)),
      shots:samples.oneshots.slice(0,16).map(name => name.slice(0,96)),
      sampleBed:samples.sampleBed, underSample:samples.underSample, beds:mixerCensus.beds, buses:mixerCensus.buses},
    music:{scoreId:music.scoreId?.slice(0,96) ?? null, mode:state.mode,
      intensity:state.intensity, underwater:state.underwater, playingOrQueued:music.isPlaying},
    parentScope:{name:scope.name.slice(0,96), disposed:scope.disposed,
      sounds:census.sounds, timers:census.timers, disposers:census.disposers},
    clock:{now:app.clock.now, real:app.clock.real, frame:app.clock.frame, mode:app.clock.mode},
    namedRng:{seed:rng.seed, streamCount:rng.streams.length,
      streams:rng.streams.slice(0,16).map(entry => ({name:entry.name.slice(0,96),
        state:entry.state.state, initial:entry.state.initial, scrambledFork:entry.state.scrambledFork}))},
    log,
  };
}

/** @param {object} report @param {string} boundary @param {unknown} observation */
export function rememberAudioBoundary(report, boundary, observation) {
  const history = observations.get(report) ?? [];
  if (history.length >= 4) return;
  history.push({boundary:boundary.slice(0,32), observation});
  observations.set(report, history);
}

/** Keep diagnostics outside compared/raw baseline data and emit only after a final red verdict.
 * @param {string} path @param {object[]} reports @param {boolean} failed */
export function publishAudioDiagnostics(path, reports, failed) {
  const retained = reports.length > 2 ? [...reports.slice(0,1), ...reports.slice(-1)] : reports;
  const runs = retained.map(report => observations.get(report) ?? []);
  for (const report of reports) observations.delete(report);
  if (!failed) { rmSync(path, {force:true}); return; }
  const limits = {runs:2, boundaries:4, logEntries:16, sampleKeys:16, rngStreams:16, bytes:65536};
  const limitation = 'Mixer samples and parent scope only; CueBank, exact child scope, context-running state, scheduler due times, Math.random and Pine-local RNG are not observed.';
  const output = `${JSON.stringify({schema:1, limitation, limits, runs}, null, 2)}\n`;
  writeFileSync(path, Buffer.byteLength(output) <= limits.bytes ? output :
    `${JSON.stringify({schema:1, limitation, limits, unavailable:'Diagnostic byte limit exceeded'})}\n`);
}
