// Meta IPHONE13-DRIFTWOOD DW12 / DW11: warm-return.mjs names the WebContent that shows the page from RunningBoard's log, so
// a round says which process held the cold boot and which the warm one.
import { expect, test } from 'vitest';
import { kernelKills, parseSlots, stageSpans, visibleAt, visibleTimeline } from '../src/scripts/memory/iphone/warm-return.mjs';

const line = (at: string, pid: number, visible: boolean): string => `Nov 21 ${at}123 runningboardd(RunningBoard)[33] <Notice>: [xpcservice<com.apple.WebKit.WebContent([app<com.apple.mobilesafari(89FE87CF-5BD2-4123-AB39-1C49E6E9CD38)>:45242])>{vt hash: 71395982}[uuid:F36BC23D-1665-4222-8F24-456439511ECC]:${String(pid)}] visiblity is ${visible ? 'yes' : 'no'}`;

test('the visible WebContent at cold control, through the robots.txt stop, and at warm control', () => {
  const timeline = visibleTimeline([line('20:10:32.673', 45248, true), line('20:10:55.026', 45244, true), line('20:10:55.123', 45248, false),
    line('20:10:55.440', 45248, true), 'Nov 21 20:10:56.000000 kernel(Sandbox)[0] <Notice>: unrelated WebContent line']);
  expect(timeline).toEqual([['20:10:32.673', 45248], ['20:10:55.026', 45244], ['20:10:55.440', 45248]]);
  expect(visibleAt(timeline, new Date(2026, 10, 21, 20, 10, 49))).toBe(45248);
  expect(visibleAt(timeline, new Date(2026, 10, 21, 20, 10, 55, 300))).toBe(45244);
  expect(visibleAt(timeline, new Date(2026, 10, 21, 20, 11, 9))).toBe(45248);
  expect(visibleAt(timeline, new Date(2026, 10, 21, 20, 10, 0))).toBeNull();
});

test('a per-process limit kill is read from the kernel\'s own lines', () => {
  const kills = kernelKills([
    'Nov 22 20:20:04.196123 kernel[0] <Notice>: memorystatus: com.apple.WebKit.WebContent [56217] exceeded mem limit: ActiveSoft 1536 MB (non-fatal)',
    'Nov 22 20:20:04.196456 kernel[0] <Notice>: memorystatus: killing process 56217 [com.apple.WebKit.WebContent] in high band FOREGROUND (100) - memorystatus_available_pages: 26422',
    'Nov 22 20:20:04.281789 kernel[0] <Notice>: memorystatus: killing_highwater_process pid 56217 [com.apple.WebKit.WebContent] (highwater 100 49s rf:-) 1572865KB - memorystatus_available_pages: 116268 compressor_size:40236',
    'Nov 22 20:17:13.374000 kernel[0] <Notice>: memorystatus: killing_idle_process pid 47285 [com.apple.MobileInstallationHelp] (long-idle-exit 0 81564s rf:low) 1824KB',
  ]);
  expect(kills.map(([at, pid, kb]) => [at, pid, kb])).toEqual([['20:20:04.196', 56217, null], ['20:20:04.281', 56217, 1572865]]);
});

// Meta QA 11-24 row 30: the shader-source cache arms (`--slot debug.cacheShaderSources=false`) and their Shaders ms.
test('an arm\'s slots parse as JSON, else as text, and a slot with no value refuses', () => {
  expect(parseSlots(['debug.cacheShaderSources=false', 'debug.collectionHint=0', 'graphics=low'])).toEqual({ 'debug.cacheShaderSources': false, 'debug.collectionHint': 0, graphics: 'low' });
  expect(() => parseSlots(['debug.cacheShaderSources'])).toThrow(/key=value/u);
});

test('the loading stages\' spans are each stage\'s longest finished span', () => {
  expect(stageSpans([
    { operation: 'stage:shaders', start: 100, end: 1633.4 }, { operation: 'stage:shaders', start: 2000, end: 2100 },
    { operation: 'stage:home', start: 10, end: null }, { operation: 'app:control-ready', start: 9000, end: 9000 }, null,
  ])).toEqual({ shaders: 1533 });
  expect(stageSpans(undefined)).toEqual({});
});
