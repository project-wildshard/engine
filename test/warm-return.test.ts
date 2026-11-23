// Meta IPHONE13-DRIFTWOOD DW12 / DW11: warm-return.mjs names the WebContent that shows the page from RunningBoard's log, so
// a round says which process held the cold boot and which the warm one.
import { expect, test } from 'vitest';
import { visibleAt, visibleTimeline } from '../scripts/memory/iphone/warm-return.mjs';

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
