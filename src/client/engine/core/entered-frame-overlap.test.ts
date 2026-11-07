import { afterEach, expect, test, vi } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the real Game method without constructing a GPU renderer.
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Strip only the actual method's types for the controlled renderer fixture.
import { stripTypeScriptTypes } from 'node:module';
// oxlint-disable-next-line import/no-nodejs-modules -- Execute repository source with explicit preparation ports, never a copied implementation.
import { runInNewContext } from 'node:vm';
import { DataTexture, Group, Scene, Vector3, type Object3D } from 'three';
import { Scope } from '../../../shared/engine/app/scope';
import { installScopeEnvironment, scopeEnvironment } from '../../../shared/engine/app/scopeEnvironment';
import { boundEntryWarmup } from '../render/entryWarmupBound';
import type { warmParkedDraws } from '../render/parkedDraws';
import { yieldTask } from '../../../shared/engine/core/workSlice';

const original = scopeEnvironment();
afterEach(() => { installScopeEnvironment(original); });

test('an early composer leaves boot view staging and streamed variants to the final inventory', async () => {
  const source = readFileSync(new URL('Game.ts', import.meta.url), 'utf8');
  const owner = new Scope('early-composer'), root = new Group(), staged = new Group();
  const calls: string[] = [], composer = { inputBuffer: {} };
  const game = { _composer: composer, frameCount: 0, levelScope: owner, rootScene: new Scene(), camera: {},
    viewmodel: { stage: (actual: Scope): Group => { expect(actual).toBe(owner); calls.push('stage'); return staged; } } };
  const method = (name: string, end: string, ports: object): ((...args: unknown[]) => unknown) => {
    const start = source.indexOf(`  ${name}(`), stop = source.indexOf(end, start);
    if (start === -1 || stop < start) throw new Error('Boot preparation method missing');
    const value: unknown = runInNewContext(stripTypeScriptTypes(`class Harness { ${source.slice(start, stop).replace("await import('../render/precompile')", 'ports')} }\nHarness.prototype.${name.replace('async ', '')}`), ports);
    if (typeof value !== 'function') throw new Error('Boot preparation method is not callable');
    return (...args) => { const result: unknown = Reflect.apply(value, game, args); return result; };
  };
  const stage = method('stageViewmodels', '\n  /** Prepare newly streamed', {});
  const warm = method('async warmSceneRoots', '\n  private postPreparation', {
    ports: { prepareSceneRoots: (): Promise<void> => { calls.push('streamed'); return Promise.resolve(); }, waitForDrawnFrame: (): Promise<void> => Promise.resolve(), LIVE_UPLOAD_BUDGET: {} },
    boundEntryWarmup: async (_scope: unknown, run: (current: () => boolean) => Promise<void>): Promise<void> => { await run(() => true); },
  });
  try {
    expect(stage(owner)).toBeNull(); await warm([root], () => true);
    expect(calls).toEqual([]);
    game.frameCount = 1;
    expect(stage(owner)).toBe(staged); await warm([root], () => true);
    expect(calls).toEqual(['stage', 'streamed']);
  } finally { owner.dispose(); }
});

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let finish: () => void = () => undefined;
  const promise = new Promise<void>(resolve => { finish = resolve; });
  return { promise, resolve: () => { finish(); } };
}

async function settled(promise: Promise<unknown>): Promise<unknown> {
  try { await promise; return null; } catch (error) { return error; }
}

type Prepare = (roots: readonly Object3D[]) => Promise<void>;
function fixture(early: () => Promise<void> = () => Promise.resolve(), final: () => Promise<void> = () => Promise.resolve()) {
  const source = readFileSync(new URL('Game.ts', import.meta.url), 'utf8');
  const start = source.indexOf('  async warmEnteredFrame('), end = source.indexOf('\n  private async ', start);
  if (start === -1 || end < start) throw new Error('Entered-frame method missing');
  const warnings: string[] = [];
  const method: unknown = runInNewContext(stripTypeScriptTypes(`class Harness { ${source.slice(start, end)} }\nHarness.prototype.warmEnteredFrame`),
    { boundEntryWarmup, diagnosticNow: () => 0,
      console: { warn: (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); } } });
  if (typeof method !== 'function') throw new Error('Entered-frame method is not callable');
  const owner = new Scope('overlap'), root = new Group(), scene = new Scene();
  const calls: string[] = [], preparationEnvironments: unknown[] = [];
  let fence: () => boolean = () => true;
  let now = 0, next = 0;
  const frames = new Map<number, (at: number) => void>();
  installScopeEnvironment({ ...original, frame: draw => { const id = ++next; frames.set(id, draw); return id; },
    cancelFrame: id => { frames.delete(id); } });
  const game = { _composer: {}, scene, frameCount: 1, postPreparation: Promise.resolve(),
    async warmEnteredRoots(actualOwner: Scope, _composer: unknown, roots: readonly Object3D[], lighting: Object3D, current: () => boolean): Promise<void> {
      expect(actualOwner).toBe(owner); expect(roots).toEqual([root]); expect(lighting).toBe(root);
      fence = current; calls.push('world'); await early();
    },
    async warmEnteredStages(): Promise<void> { calls.push('final'); await final(); },
    async prepareEnteredPrograms(_owner: Scope, _composer: unknown, current: () => boolean, _root: unknown, _arrival: unknown, _stage: unknown, _progress: unknown, environment: unknown): Promise<void> {
      preparationEnvironments.push(environment);
      fence = current; calls.push('page-programs'); await early();
    },
  };
  return { owner, root, game, calls, preparationEnvironments, warnings, current: () => fence(),
    run: (before?: (prepare: Prepare, prepareFrame: (environment?: DataTexture | null) => Promise<void>) => Promise<void> | void): Promise<unknown> => Promise.resolve(Reflect.apply(method, game, [owner, root, before])),
    frame: (): void => { game.frameCount++; now += 100; const due = [...frames.values()]; frames.clear(); for (const draw of due) draw(now); },
  };
}

test('world programs run while content is pending and final inventory still gates readiness', async () => {
  const content = deferred(), prepared = deferred(), f = fixture();
  let finished = false;
  const run = f.run(async prepare => { await prepare([f.root]); prepared.resolve(); await content.promise; f.calls.push('complete-content'); });
  const observed = settled((async () => { await run; finished = true; })());
  try {
    expect(await Promise.race([prepared.promise.then(() => 'prepared'), observed])).toBe('prepared');
    expect(f.calls).toEqual(['world']); expect(finished).toBe(false);
    content.resolve(); await run;
    expect(f.calls).toEqual(['world', 'complete-content', 'final']); expect(finished).toBe(true);
  } finally { content.resolve(); f.owner.dispose(); await observed; }
});

test('page programs overlap content without drawing or replacing the final inventory', async () => {
  const content = deferred(), prepared = deferred(), f = fixture();
  const run = f.run(async (_roots, prepareFrame) => {
    await prepareFrame(); prepared.resolve(); await content.promise;
  });
  const observed = settled(run);
  try {
    expect(await Promise.race([prepared.promise.then(() => 'prepared'), observed])).toBe('prepared');
    expect(f.calls).toEqual(['page-programs']);
    content.resolve(); await run;
    expect(f.calls).toEqual(['page-programs', 'final']);
  } finally {content.resolve(); f.owner.dispose(); await observed;}
});

test('initial boot can overlap compilation without adding crossing first draws', async () => {
  const content = deferred(), prepared = deferred(), f = fixture();
  f.game.frameCount = 0;
  const environment = new DataTexture(new Uint8Array(4), 1, 1);
  const run = f.run(async (_roots, prepareFrame) => {
    // The construction binding ends while its asynchronous sky preparation runs.
    f.game.scene = new Scene();
    await prepareFrame(environment); prepared.resolve(); await content.promise;
  });
  const observed = settled(run);
  try {
    expect(await Promise.race([prepared.promise.then(() => 'prepared'), observed])).toBe('prepared');
    expect(f.calls).toEqual(['page-programs']);
    expect(f.preparationEnvironments).toEqual([environment]);
    expect(f.game.scene.environment).toBeNull();
    content.resolve(); await run;
    expect(f.calls).toEqual(['page-programs']);
  } finally {content.resolve(); f.owner.dispose(); environment.dispose(); await observed;}
});

// Content and final inventory both gate readiness, independent of elapsed time.
test.each(['roots', 'page'])('%s preparation waits for actual content and complete final inventory', async mode => {
  const prepared = deferred(), content = deferred(), final = deferred(), enteredFinal = deferred();
  const f = fixture(() => prepared.promise, () => { enteredFinal.resolve(); return final.promise; });
  const run = f.run(async (prepare, prepareFrame) => {
    await (mode === 'roots' ? prepare([f.root]) : prepareFrame()); await content.promise;
  });
  const observed = settled(run);
  try {
    for (let i = 0; i < 120; i++) f.frame();
    prepared.resolve(); content.resolve();
    expect(await Promise.race([enteredFinal.promise.then(() => 'final'), observed])).toBe('final');
    for (let i = 0; i < 185; i++) f.frame();
    expect(await Promise.race([observed, new Promise(resolve => { setTimeout(() => { resolve('pending'); }, 0); })])).toBe('pending');
    for (let i = 0; i < 2000; i++) f.frame();
    expect(f.current()).toBe(true);
    expect(Reflect.get(Reflect.get(f.game, '_entryPreparation'), 'stalled')).toBeUndefined();
    final.resolve(); expect(await observed).toBeNull(); expect(f.warnings).toEqual([]);
  } finally { prepared.resolve(); content.resolve(); final.resolve(); f.owner.dispose(); await observed; }
});

test('elapsed time never substitutes for pending content', async () => {
  const content = deferred(), f = fixture();
  const observed = settled(f.run(async () => { await content.promise; }));
  try {
    for (let i = 0; i < 2000; i++) f.frame();
    expect(await Promise.race([observed, Promise.resolve('pending')])).toBe('pending');
    expect(f.calls).not.toContain('final');
    content.resolve(); expect(await observed).toBeNull(); expect(f.calls).toContain('final');
  } finally { content.resolve(); f.owner.dispose(); await observed; }
});

test('retirement during the content rendezvous fences the abandoned final warm-up', async () => {
  const prepared = deferred(), content = deferred(), f = fixture();
  const run = f.run(async prepare => { await prepare([f.root]); prepared.resolve(); await content.promise; });
  const observed = settled(run);
  try {
    expect(await Promise.race([prepared.promise.then(() => 'prepared'), observed])).toBe('prepared');
    f.owner.dispose();
    expect(String(await observed)).toMatch(/owner left/u); expect(f.current()).toBe(false);
    content.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(f.calls).toEqual(['world']);
  } finally { content.resolve(); f.owner.dispose(); await observed; }
});

test.each(['roots', 'page'])('an early %s refusal propagates without publishing a final frame', async mode => {
  const f = fixture(() => Promise.reject(new Error('exact program refused')));
  try {
    await expect(f.run((prepare, prepareFrame) => mode === 'roots' ? prepare([f.root]) : prepareFrame())).rejects.toThrow('exact program refused');
    expect(f.calls).toEqual([mode === 'roots' ? 'world' : 'page-programs']);
  } finally { f.owner.dispose(); }
});

test('early programs use the rendered page scene and the installing region environment', async () => {
  const source = readFileSync(new URL('Game.ts', import.meta.url), 'utf8');
  const start = source.indexOf('  private async warmEnteredRoots('), end = source.indexOf('\n  private async ', start + 1);
  if (start === -1 || end < start) throw new Error('Early-root method missing');
  const loader = "await import('../render/precompile')", body = source.slice(start, end);
  if (!body.includes(loader)) throw new Error('Early-root loader port missing');
  const calls: unknown[][] = [];
  // Replace only module loading; execute the actual caller and capture its render inputs.
  const method: unknown = runInNewContext(stripTypeScriptTypes(`class Harness { ${body.replace(loader, 'preparation')} }\nHarness.prototype.warmEnteredRoots`),
    { preparation: { prepareSceneRoots: (...args: unknown[]): Promise<void> => { calls.push(args); return Promise.resolve(); },
      waitForDrawnFrame: () => Promise.resolve(), LIVE_UPLOAD_BUDGET: { ms: 6, bytes: 1 } } });
  if (typeof method !== 'function') throw new Error('Early-root method is not callable');
  const rootScene = new Scene(), regional = new Scene(), root = new Group(), owner = new Scope('regional-programs');
  const environment = new DataTexture(new Uint8Array(8), 1, 2); regional.environment = environment;
  const composer = { inputBuffer: null }, game = { rootScene, scene: regional, renderer: {}, camera: {}, frameCount: 1, _composer: composer };
  try {
    await Reflect.apply(method, game, [owner, composer, [root], root, () => !owner.disposed]);
    expect(calls).toHaveLength(1); expect(calls[0]?.[2]).toBe(rootScene);
    expect(calls[0]?.[4]).toEqual([root]); expect(calls[0]?.[9]).toBe(root); expect(calls[0]?.[10]).toBe(environment);
    expect(calls[0]?.[11]).toBe(true);
    await Reflect.apply(method, game, [owner, composer, [root], root, () => !owner.disposed, false]);
    expect(calls[1]?.[11]).toBe(false);
  } finally { owner.dispose(); environment.dispose(); }
});

test('the boot entry leaves its roots\' road variants for play, then links them nearest-first after control (S1)', async () => {
  const source = readFileSync(new URL('Game.ts', import.meta.url), 'utf8'), loader = "await import('../render/precompile')";
  const slice = (name: string): string => {
    const start = source.indexOf(name), end = source.indexOf('\n  private async ', start + 1);
    if (start === -1 || end < start) throw new Error(`${name} missing`);
    return source.slice(start, end);
  };
  const early = slice('  private async warmEnteredRoots('), later = early.slice(early.indexOf('  async warmDeferredEntryRoots('));
  const calls: unknown[][] = [];
  const preparation = { prepareSceneRoots: (...args: unknown[]): Promise<void> => { calls.push(args); return Promise.resolve(); },
    waitForDrawnFrame: () => Promise.resolve(), LIVE_UPLOAD_BUDGET: { ms: 6, bytes: 1 } };
  const harness = (body: string, name: string): unknown => runInNewContext(stripTypeScriptTypes(`class Harness { ${body.replaceAll(loader, 'preparation')} }\nHarness.prototype.${name}`),
    { preparation, THREE: { Vector3 } });
  const enterRoots = harness(early.slice(0, early.indexOf('  async warmDeferredEntryRoots(')), 'warmEnteredRoots'), warmDeferred = harness(later, 'warmDeferredEntryRoots');
  if (typeof enterRoots !== 'function' || typeof warmDeferred !== 'function') throw new Error('Entry root methods are not callable');
  const rootScene = new Scene(), home = new Group(), gone = new Group(), owner = new Scope('home-programs'), left = new Scope('left-programs');
  const composer = { inputBuffer: null }, camera = { getWorldPosition: (at: Vector3): Vector3 => at.set(1, 2, 3) };
  const game = { rootScene, scene: rootScene, renderer: {}, camera, frameCount: 0, _composer: composer, deferredEntryRoots: [] as unknown[] };
  try {
    await Reflect.apply(enterRoots, game, [owner, composer, [home], home, () => true]);
    await Reflect.apply(enterRoots, game, [left, composer, [gone], gone, () => true]);
    // at boot: resources only, no scene or road programs yet
    expect(calls.map(call => [call[8], call[11]])).toEqual([[false, false], [false, false]]);
    expect(game.deferredEntryRoots).toHaveLength(2);
    left.dispose(); game.frameCount = 5;
    await Reflect.apply(warmDeferred, game, [() => true]);
    expect(calls).toHaveLength(3);
    const linked = calls[2] ?? [];
    expect(linked[4]).toEqual([home]); expect(linked[8]).toBe(false); expect(linked[11]).toBe(true);
    expect(typeof linked[6]).toBe('function'); expect(linked[12]).toEqual(new Vector3(1, 2, 3));
    expect(game.deferredEntryRoots).toHaveLength(0);
  } finally { owner.dispose(); left.dispose(); }
});

test('page preparation uses final program inputs without drawing and fences a changed composer', async () => {
  const source = readFileSync(new URL('Game.ts', import.meta.url), 'utf8');
  const start = source.indexOf('  private async prepareEnteredPrograms('), end = source.indexOf('\n  private async ', start + 1);
  if (start === -1 || end < start) throw new Error('Page program method missing');
  const calls: unknown[][] = [], waits: unknown[][] = [];
  const body = source.slice(start, end).replace("await import('../render/precompile')", 'preparation');
  const method: unknown = runInNewContext(stripTypeScriptTypes(`class Harness { ${body} }\nHarness.prototype.prepareEnteredPrograms`), {
    navigator: {userAgent: 'AppleWebKit'}, preparation: {
      precompileLevel: (...args: unknown[]): Promise<number> => {calls.push(args); return Promise.resolve(0);},
      waitForDrawnFrame: (...args: unknown[]): Promise<void> => {waits.push(args); return Promise.resolve();},
      LIVE_UPLOAD_BUDGET: {ms: 6, bytes: 1}, LIVE_PRECOMPILE_SLICE_MS: 6,
    },
  });
  if (typeof method !== 'function') throw new Error('Page program method is not callable');
  const owner = new Scope('page-programs'), root = new Group(), models = new Group(), scene = new Scene();
  const environment = new DataTexture(new Uint8Array(8), 1, 2); scene.environment = environment;
  let draws = 0;
  const composer = {render: (): void => {draws++;}}, game = {scene, frameCount: 1, _composer: composer, warmTurnYaws: (): number[] => [Math.PI],
    viewmodel: {staged: (scope: Scope): Group => {expect(scope).toBe(owner); return models;}}};
  const stage = (): void => undefined, progress = (): void => undefined;
  try {
    await Reflect.apply(method, game, [owner, composer, () => !owner.disposed, root, undefined, stage, progress]);
    expect(draws).toBe(0); expect(calls).toHaveLength(1); expect(calls[0]?.slice(0, 2)).toEqual([game, progress]);
    const options = calls[0]?.[2];
    if (typeof options !== 'object' || options === null) throw new Error('Missing program options');
    expect(options).toMatchObject({chunkCasters: false, owner, futureLighting: root, futureEnvironment: environment,
      isolateImageUploads: true, sliceMs: 6, leaving: [models], drawnOnly: false, onStage: stage, uploadBudget: {ms: 6, bytes: 1}});
    game.frameCount = 0;
    scene.environment = null;
    await Reflect.apply(method, game, [owner, composer, () => !owner.disposed, root, undefined, stage, progress, environment]);
    const bootOptions = calls[1]?.[2];
    if (typeof bootOptions !== 'object' || bootOptions === null) throw new Error('Missing initial census options');
    expect(Object.keys(bootOptions).sort()).toEqual(['chunkCasters', 'current', 'drawnOnly', 'futureEnvironment', 'futureLighting', 'onStage', 'owner', 'sceneOnly', 'sliceMs', 'turns']);
    expect(Reflect.get(bootOptions, 'current')).toBeTypeOf('function');
    expect(bootOptions).toMatchObject({owner, onStage: stage, chunkCasters: false, sliceMs: 12, sceneOnly: true, drawnOnly: true, turns: [Math.PI], futureLighting: root, futureEnvironment: environment});
    expect(draws).toBe(0); expect(waits).toHaveLength(0);
    game.frameCount = 1;
    const pause: unknown = Reflect.get(options, 'pause'), current: unknown = Reflect.get(options, 'current');
    if (typeof pause !== 'function' || typeof current !== 'function') throw new Error('Missing live program fences');
    await Reflect.apply(pause, undefined, []);
    expect(waits[0]?.[0]).toBe(owner); expect(Reflect.apply(current, undefined, [])).toBe(true);
    game._composer = {render: (): void => undefined};
    expect(Reflect.apply(current, undefined, [])).toBe(false);
    game._composer = composer; owner.dispose();
    expect(Reflect.apply(current, undefined, [])).toBe(false);
  } finally {owner.dispose(); environment.dispose();}
});

function streamedGeometry(draw: typeof warmParkedDraws) {
  const source = readFileSync(new URL('Game.ts', import.meta.url), 'utf8');
  const start = source.indexOf('  async warmSceneRoots('), end = source.indexOf('\n  private postPreparation', start);
  if (start === -1 || end < start) throw new Error('Streamed preparation method missing');
  const owner = new Scope('streamed-geometry'), scene = new Scene(), root = new Group(); root.visible = false; scene.add(root);
  const prepare = vi.fn<() => Promise<void>>().mockResolvedValue(undefined), pause = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const game = { _composer: { inputBuffer: {} }, frameCount: 0, frameGate: (): boolean => false, levelScope: owner, rootScene: scene, camera: {}, renderer: {} };
  const presentation = { state: 'covered' }, task = vi.fn<typeof yieldTask>().mockImplementation(scope => yieldTask(scope));
  const body = source.slice(start, end).replace("await import('../render/precompile')", 'programs').replace("await import('../render/parkedDraws')", 'nativeDraws');
  const method: unknown = runInNewContext(stripTypeScriptTypes(`class Harness { ${body} }\nHarness.prototype.warmSceneRoots`), {
    programs: { prepareSceneRoots: prepare, waitForDrawnFrame: pause, LIVE_UPLOAD_BUDGET: {} }, nativeDraws: { warmParkedDraws: draw }, boundEntryWarmup, yieldTask: task, pagePresentation: presentation, isDev: () => false, diagnosticNow: () => 0,
  });
  if (typeof method !== 'function') throw new Error('Streamed preparation method is not callable');
  return { owner, root, scene, game, prepare, pause, presentation, task,
    run: (): Promise<unknown> => Promise.resolve(Reflect.apply(method, game, [[root], () => !owner.disposed, undefined, { drawGeometry: true }])),
  };
}

test('opted-in streamed geometry first-draws its actual hidden root before boot exposure', async () => {
  const native = deferred(), draw = vi.fn<typeof warmParkedDraws>().mockImplementation(async (_renderer, scene, _camera, _target, root, _current, _pause, options) => {
    expect(root.parent).toBe(scene); expect(root.visible).toBe(false);
    options?.onProgress?.(0, 1); await native.promise; options?.onProgress?.(1, 1); return 1;
  });
  const f = streamedGeometry(draw); let ready = false;
  const pending = f.run().then(() => { ready = true; return undefined; });
  try {
    await vi.waitFor(() => { expect(draw).toHaveBeenCalledOnce(); });
    expect(f.prepare).toHaveBeenCalledOnce(); expect(ready).toBe(false);
    expect(draw.mock.calls[0]?.[4]).toBe(f.root);
    native.resolve(); await pending;
    expect(ready).toBe(true); expect(f.root.visible).toBe(false); expect(f.root.parent).toBe(f.scene);
  } finally { native.resolve(); await pending; f.owner.dispose(); }
});

test('an incomplete native warm cannot publish streamed geometry as ready', async () => {
  const draw = vi.fn<typeof warmParkedDraws>().mockImplementation((_renderer, _scene, _camera, _target, _root, _current, _pause, options) => {
    options?.onProgress?.(0, 1); return Promise.resolve(0);
  });
  const f = streamedGeometry(draw);
  try { await expect(f.run()).rejects.toThrow('Streamed geometry preparation did not complete'); }
  finally { f.owner.dispose(); }
});


for (const [gate, state] of [[false, 'play'], [true, 'covered']] as const) {
  test(`hidden loader draw count does not wait for live frames (gate ${gate}, view ${state})`, async () => {
    const draw = vi.fn<typeof warmParkedDraws>().mockImplementation(async (_renderer, _scene, _camera, _target, _root, _current, pause, options) => {
      options?.onProgress?.(0, 1); await pause(); options?.onProgress?.(1, 1); return 1;
    });
    const f = streamedGeometry(draw); f.game.frameCount = 1; f.game.frameGate = () => gate; f.presentation.state = state;
    try {
      await f.run();
      expect(draw).toHaveBeenCalledOnce(); expect(f.pause).not.toHaveBeenCalled(); expect(f.task).toHaveBeenCalledWith(f.owner);
    } finally { f.owner.dispose(); }
  });
}
