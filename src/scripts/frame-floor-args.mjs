const switches = new Set(['help', 'worker', 'draw-budget', 'draw-budget-report-only', 'software-draw-census', 'quiet', 'devserver', 'chromium-phone', 'entry-settle', 'gl-time', 'gpu-bisect', 'frame-timeline', 'task-clock', 'road-approach', 'entry-socket', 'wasm-memory-probe', 'pause-ablation', 'buffer-ablation']);
const values = new Set(['base', 'chromium-cpu', 'chromium-angle', 'desktop-dpr', 'cpu-profile', 'deadline', 'developer', 'device', 'frames', 'gl-observer', 'gpu-trace',
  'grid-cell', 'grid-cell-pose', 'grid-routes', 'grid-scenario', 'regrade', 'rev', 'rising-islet', 'safari-profile', 'safari-steady', 'safari-drive', 'safari-prefix', 'safari-window',
  'settle', 'shards', 'surface', 'scratch-dir', 'worker-out', 'device-save', 'expect-system', 'setting', 'output-dir',
  'textures', 'ktx2-probe', 'serve-shard', 'serve-base', 'standing-poses', 'standing-file', 'native-memory', 'webkit-timeline', 'webkit-steady', 'native-pressure', 'wasm-constructors', 'jsc-gc-log', 'jsc-ram-size']);

/** Explicit EP10 policy; reporting retains every miss without changing the floor verdict.
 * @param {readonly string[]} args
 * @returns {'enforce'|'report-only'} */
export function frameFloorDrawBudgetMode(args) {
  if (args.includes('--draw-budget') && args.includes('--draw-budget-report-only')) throw new Error('Choose one draw budget mode');
  return args.includes('--draw-budget-report-only') ? 'report-only' : 'enforce';
}
/** @param {readonly string[]} args */
const drawBudgetSelected = args => args.includes('--draw-budget') || args.includes('--draw-budget-report-only');

/** Diagnostic throttle or the explicit EP10 4x protocol; never an official Simulator floor.
 * @param {readonly string[]} args */
export function frameFloorChromiumCpuRate(args) {
  const selections = args.filter(arg => arg.startsWith('--chromium-cpu='));
  const value = selections[0];
  if (value === undefined) return 1;
  const rate = Number(value.slice('--chromium-cpu='.length));
  if (selections.length !== 1 || !Number.isSafeInteger(rate) || rate < 1 || rate > 20
    || !args.includes('--surface=desktop') || !args.includes('--chromium-phone')
    || args.some(arg => arg.startsWith('--regrade='))
    || !(args.some(arg => /^(?:--cpu-profile|--gpu-trace)=.+/u.test(arg)) || drawBudgetSelected(args) && rate === 4))
    throw new Error('--chromium-cpu requires a diagnostic phone Chromium profile and one integer rate from 1 to 20');
  return rate;
}

/** An explicit software renderer is confined to Linux report-only phone rows.
 * @param {readonly string[]} args
 * @param {string} platform */
export function frameFloorChromiumAngle(args, platform = process.platform) {
  const selections = args.filter(arg => arg.startsWith('--chromium-angle=')), selected = selections[0]?.slice('--chromium-angle='.length);
  if (selections.length > 1 || selected !== undefined && selected !== 'metal' && selected !== 'swiftshader') throw new Error('Unknown Chromium measurement backend');
  if (selected === 'swiftshader' && (platform !== 'linux' || !args.includes('--draw-budget-report-only')
    || !args.includes('--surface=desktop') || !args.includes('--chromium-phone') || frameFloorChromiumCpuRate(args) !== 4))
    throw new Error('SwiftShader requires explicit Linux report-only phone 4x');
  return { angle: selected ?? (platform === 'darwin' ? 'metal' : 'swiftshader'), explicit: selected !== undefined };
}

/** Bounded software delivery census, never the phone/floor measurement.
 * @param {readonly string[]} args
 * @param {string} platform
 * @returns {{viewport:{width:201,height:437},frames:4,scope:'spawn-only'}|null} */
export function frameFloorSoftwareCensus(args, platform = process.platform) {
  if (!args.includes('--software-draw-census')) return null;
  const backend = frameFloorChromiumAngle(args, platform);
  if (platform !== 'linux' || backend.angle !== 'swiftshader' || !backend.explicit || !args.includes('--draw-budget-report-only')
    || args.includes('--draw-budget') || !args.includes('--surface=desktop') || !args.includes('--chromium-phone')
    || frameFloorChromiumCpuRate(args) !== 4 || args.filter(arg => arg.startsWith('--frames=')).length !== 1 || !args.includes('--frames=4')
    || args.some(arg => arg.startsWith('--standing-poses=') && arg !== '--standing-poses=' || arg.startsWith('--grid-scenario=') && arg !== '--grid-scenario=baseline'
      || arg.startsWith('--shards=') && arg.slice(9).split(',').includes('grid')))
    throw new Error('Software census requires explicit Linux report-only SwiftShader, four spawn-only frames');
  return {viewport: {width: 201, height: 437}, frames: 4, scope: 'spawn-only'};
}

/** Refuse misspelled or incomplete floor commands before a build, browser or Simulator lease is acquired.
 * @param {readonly string[]} args
 */
export function validateFrameFloorArgs(args) {
  frameFloorDrawBudgetMode(args);
  frameFloorChromiumAngle(args);
  frameFloorSoftwareCensus(args);
  const cpuRate = frameFloorChromiumCpuRate(args);
  if (drawBudgetSelected(args) && (cpuRate !== 4 || !args.includes('--chromium-phone') || !args.includes('--surface=desktop')))
    throw new Error('Draw budget requires phone Chromium at exactly 4x CPU');
  if (drawBudgetSelected(args) && args.some(arg => ['--gl-time', '--gpu-bisect', '--task-clock', '--gl-observer=on'].includes(arg)
    || /^(?:--cpu-profile|--gpu-trace)=/u.test(arg))) throw new Error('Draw budget requires a window without profiling or GL wrappers');
  for (const arg of args) {
    const equals = arg.indexOf('='), name = arg.slice(2, equals === -1 ? undefined : equals);
    if (!arg.startsWith('--') || !(equals === -1 ? switches : values).has(name))
      throw new Error(`Unknown frame-floor argument: ${arg}`);
  }
  if (args.includes('--grid-scenario=milestone') && !args.includes('--devserver'))
    throw new Error('Milestone floor requires --devserver (the complete Developer catalogue includes Nine)');
  if (args.includes('--quiet') && (args.filter(arg => arg.startsWith('--surface=')).length !== 1 || !args.includes('--surface=sim')))
    throw new Error('Quiet frame floors require --surface=sim');
  if (args.includes('--chromium-phone') && !args.includes('--surface=desktop'))
    throw new Error('--chromium-phone measures the phone tier on the Chromium surface: requires --surface=desktop');
  if (args.some(arg => arg.startsWith('--webkit-timeline=')) && !args.includes('--surface=sim'))
    throw new Error('WebKit timelines require --surface=sim');
  if (args.some(arg => arg.startsWith('--wasm-constructors=')) && !args.includes('--surface=sim'))
    throw new Error('Native constructor observations require --surface=sim');
  if (args.includes('--wasm-memory-probe') && (!args.includes('--surface=sim') || args.includes('--quiet')
    || !args.some(arg => arg.startsWith('--wasm-constructors=') && arg.length > '--wasm-constructors='.length)
    || !args.some(arg => arg.startsWith('--webkit-timeline=') && arg.length > '--webkit-timeline='.length)))
    throw new Error('Blank memory probe requires no-quiet Simulator, native constructors and Timeline');
  const nativeGc = args.filter(arg => arg.startsWith('--jsc-gc-log='));
  const nativeRam = args.filter(arg => arg.startsWith('--jsc-ram-size='));
  if (nativeRam.length > 0 && (nativeRam.length !== 1 || nativeGc.length !== 1
    || !/^--jsc-ram-size=[1-9]\d*$/u.test(nativeRam[0] ?? '')
    || !Number.isSafeInteger(Number((nativeRam[0] ?? '').split('=')[1]))))
    throw new Error('Native JSC RAM override requires one positive byte count and native GC logging');
  if (nativeGc.length > 0 && (nativeGc.length !== 1 || nativeGc[0] === '--jsc-gc-log='
    || !args.includes('--surface=sim') || !args.includes('--shards=grid')
    || !args.some(arg => arg.startsWith('--grid-scenario=') && arg !== '--grid-scenario=baseline')
    || args.some(arg => /^--(?:webkit-|safari-|native-pressure=|wasm-constructors=|native-memory=|cpu-profile=|gpu-trace=)/u.test(arg))
    || ['--pause-ablation','--buffer-ablation','--wasm-memory-probe','--gl-time','--gpu-bisect','--frame-timeline','--task-clock'].some(arg => args.includes(arg))))
    throw new Error('Native JSC GC log requires one Simulator grid visit without other recorders');
  const timelineSteady = args.filter(arg => arg.startsWith('--webkit-steady='));
  if (timelineSteady.length > 0 && (timelineSteady.length !== 1
    || !/^--webkit-steady=grid-[a-zA-Z0-9_.-]{1,128}(?:,grid-[a-zA-Z0-9_.-]{1,128})?$/u.test(timelineSteady[0] ?? '')
    || new Set((timelineSteady[0] ?? '').slice('--webkit-steady='.length).split(',')).size !== (timelineSteady[0] ?? '').split(',').length
    || !args.includes('--surface=sim') || !args.includes('--shards=grid')
    || !args.some(arg => arg.startsWith('--grid-scenario=') && arg !== '--grid-scenario=baseline')
    || !args.some(arg => arg.startsWith('--webkit-timeline=') && arg.length > '--webkit-timeline='.length)
    || args.some(arg => arg.startsWith('--safari-') || arg.startsWith('--wasm-constructors=') || arg.startsWith('--cpu-profile=') || arg.startsWith('--gpu-trace=') || arg.startsWith('--native-memory='))
    || ['--gl-time', '--gpu-bisect', '--frame-timeline', '--task-clock', '--wasm-memory-probe'].some(arg => args.includes(arg))))
    throw new Error('Steady Timeline requires one or two distinct Simulator grid poses and --webkit-timeline, without other recorders');
  if (args.some(arg => arg.startsWith('--native-pressure=')) && (timelineSteady.length !== 1
    || !args.some(arg => arg.startsWith('--native-pressure=') && arg.length > '--native-pressure='.length)))
    throw new Error('Native pressure probe requires a selected settled Timeline and an output directory');
  if (args.includes('--pause-ablation') && args.includes('--buffer-ablation')) throw new Error('Choose only one ablation mode');
  if ((args.includes('--pause-ablation') || args.includes('--buffer-ablation')) && (timelineSteady.length !== 1
    || timelineSteady[0] !== '--webkit-steady=grid-nalati-interior'
    || args.some(arg => arg.startsWith('--native-pressure='))))
    throw new Error('Pause ablation requires only the selected Nalati steady Timeline');
  const steady = args.filter(arg => arg.startsWith('--safari-steady='));
  const drive = args.filter(arg => arg.startsWith('--safari-drive='));
  const prefix = args.filter(arg => arg.startsWith('--safari-prefix='));
  const window = args.filter(arg => arg.startsWith('--safari-window='));
  if (window.length > 0 && (window.length !== 1 || prefix.length > 0 || steady.length > 0 || drive.length > 0
    || args.some(arg => arg.startsWith('--wasm-constructors=') || arg.startsWith('--webkit-timeline='))
    || !parseSafariWindow(window[0]?.slice('--safari-window='.length) ?? '')
    || !args.includes('--surface=sim') || !args.includes('--shards=grid')
    || !args.some(arg => arg.startsWith('--safari-profile=') && arg.length > '--safari-profile='.length)
    || !args.some(arg => arg.startsWith('--grid-scenario=') && arg !== '--grid-scenario=baseline')))
    throw new Error('Safari window requires one bounded Simulator grid drive and --safari-profile without other sampling selections');
  const selected = [...steady, ...drive];
  const paired = steady.length === 1 && drive.length === 1 && drive[0] !== undefined
    && steady[0] === `--safari-steady=grid-${drive[0].slice('--safari-drive='.length)}`;
  if (selected.length > 0 && (steady.length > 1 || drive.length > 1 || selected.length > 1 && !paired
    || selected.some(selection => !/^[a-zA-Z0-9_.-]{1,128}$/u.test(selection.slice(selection.indexOf('=') + 1)))
    || !args.includes('--surface=sim') || !args.includes('--shards=grid')
    || !args.some(arg => arg.startsWith('--safari-profile=') && arg.length > '--safari-profile='.length)
    || !args.some(arg => arg.startsWith('--grid-scenario=') && arg !== '--grid-scenario=baseline')))
    throw new Error('Selected Safari sampling requires one pose or drive (or a matching pair), Simulator grid travel and --safari-profile');
  if (prefix.length > 0 && (prefix.length !== 1 || selected.length > 0 || args.includes('--quiet') || !args.includes('--surface=sim')
    || !args.includes('--shards=grid') || !/^--safari-prefix=[a-zA-Z0-9_.-]{1,128}$/u.test(prefix[0] ?? '')
    || !args.some(arg => arg.startsWith('--safari-profile=') && arg.length > '--safari-profile='.length)
    || !args.some(arg => arg.startsWith('--grid-scenario=') && arg !== '--grid-scenario=baseline')))
    throw new Error('Safari prefix sampling requires one no-quiet Simulator grid drive and --safari-profile, without steady or extended-drive selection');
}

/** @param {string} value */
export function parseSafariWindow(value) {
  if (value === '') return null;
  const match = /^([a-zA-Z0-9_.-]{1,128}):(\d{1,3}):(\d{1,3})$/u.exec(value);
  if (!match || match[1] === undefined || match[2] === undefined || match[3] === undefined) return null;
  const from = Number(match[2]), to = Number(match[3]);
  if (from < 0 || to <= from || to > 120 || to - from > 20) return null;
  return { route: match[1], fromMs: from * 1000, toMs: to * 1000 };
}
