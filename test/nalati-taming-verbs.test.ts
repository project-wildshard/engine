import {expect,test} from 'vitest';
import {runNalatiFieldApproach} from './fixtures/headless/nalati-taming-run';
import {prepareHeadlessRuntime} from './fixtures/nalati-verbs';
import {withNalatiCompanions} from './fixtures/nalati-companions-native';

// FAST-SLOW-TESTS FS4: the field taming runs as two legs in two files. This leg walks from spawn and earns the prompt;
// nalati-taming-verbs-rounds.test.ts rides all five rounds from a saved breaking start, with the mid-round checkpoint,
// adoption and the companion call.
test('the entry walk earns a living stallion prompt and its breaking start restores',async()=>{
  expect(typeof window).toBe('undefined');expect(typeof document).toBe('undefined');
  // After the real walk the player stands 3 m west and south of the grazing stallion rather than chasing it for
  // 5,900 ticks; the stallion still shies, and the prompt is still earned by the real approach law.
  const report=await runNalatiFieldApproach({prepare:withNalatiCompanions(prepareHeadlessRuntime),approach:{x:-3,z:-3}});
  expect(report.approachTicks).toBeGreaterThan(0);expect(report.promptTick).toBeGreaterThan(report.approachTicks);
  expect(report.breakingTick).toBeGreaterThan(report.promptTick);
// The existing native taming/checkpoint proof uses this same finite bound. J112's walk and a second try take CI past 180 s.
},450_000);
