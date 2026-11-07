// CI12 Nalati Storm Titan: the open arena encounter's tie and boundary answers, split out of ArenaRoomEncounter (arenaTie /
// arenaBoundary, renderer-free), apply exactly as the encounter's inline code did: the same calls in the same order (arm,
// disarm, toast, prompt, the player held, the wall, the clear, the kill and the feat) over every kind of answer.
import { expect, test } from 'vitest';
import { arenaBoundary, arenaTie, type ArenaTieObservation } from '../src/shared/game/boss/arenaAnswers';

const tieLines = ['Tied: ride him down', 'Tied on foot', 'The storm hides the line'], lines = { tie: 'TIE', tieOnFoot: 'TIE ON FOOT', tieQuiet: 'TIE QUIETLY' };
const record = { kind: 'storm-titan', variant: 'jel-ata' };
/** the n-th scripted answer: every flag and index combination comes round */
function answerOf(n: number): Record<string, number> {
  return { arm: n % 3 === 0 ? 1 : 0, disarm: (n >> 1) % 2, index: (n % 5) - 1, radius: (n % 7) * .5, label: n % 3, x: n % 4 === 0 ? n * .1 : Number.NaN, z: n % 6 === 0 ? -n * .1 : Number.NaN,
    hurt: (n >> 2) % 2, clear: n % 11 === 0 ? 1 : 0 };
}
const defined = (a: Record<string, number>): Record<string, number> => Object.fromEntries(Object.entries(a).filter(([, value]) => !Number.isNaN(value)));

test('the tie and boundary answers apply as the encounter did', () => {
  for (let n = 0; n < 3000; n++) {
    const answer = defined(answerOf(n)), observed: ArenaTieObservation = { engaged: n % 2 === 0, victory: n % 9 === 0, hit: n % 4 === 1, mounted: n % 3 === 2, storm: n % 5 > 1 };
    const run = (split: boolean): string[] => {
      const log: string[] = [], fight = { tied: n % 2 === 1 }, prompt = { radius: -1, label: '' }, player = { x: 1, z: 2 };
      const boss = { arm: () => { log.push(`arm ${String(fight.tied)}`); }, disarm: () => { log.push(`disarm ${String(fight.tied)}`); } };
      const toast = (line: string): void => { log.push(`toast ${line}`); };
      const life = { event: (event: string, frame: Readonly<Record<string, number>> = {}): Readonly<Record<string, number>> => { log.push(`event ${event} ${JSON.stringify(frame)}`); return answer; } };
      const persistence = { kill: (kind: string, variant: string) => { log.push(`kill ${kind} ${variant}`); }, feat: (kind: string) => { log.push(`feat ${kind}`); } };
      const wall = (): void => { log.push(`wall ${player.x},${player.z}`); }, clear = (): void => { log.push('clear'); };
      if (split) {
        arenaTie(life, observed, tieLines, { boss, fight, toast });
        arenaBoundary(answer, lines, record, { boss, fight, toast, prompt, player, wall, clear, get persistence() { log.push('persistence'); return persistence; } });
      } else {
        // ArenaRoomEncounter.tie and the boundary half of update before the split (arenaRoom.ts, before CI12)
        const a = life.event('tie', { engaged: Number(observed.engaged), victory: Number(observed.victory), hit: Number(observed.hit), mounted: Number(observed.mounted), storm: Number(observed.storm) });
        if (a['arm'] === 1) { fight.tied = true; if (a['disarm'] === 1) boss.disarm(); boss.arm(); } const line = tieLines[a['index'] ?? -1]; if (line) toast(line);
        prompt.radius = answer['radius'] ?? 0; prompt.label = answer['label'] === 1 ? lines.tieOnFoot : answer['label'] === 2 ? lines.tieQuiet : lines.tie;
        if (answer['disarm'] === 1) { fight.tied = false; boss.disarm(); } const p = player; p.x = answer['x'] ?? p.x; p.z = answer['z'] ?? p.z;
        if (answer['hurt'] === 1) wall();
        if (answer['clear'] === 1) { fight.tied = false; clear(); log.push('persistence'); persistence.kill(record.kind, record.variant); persistence.feat(record.kind); }
      }
      log.push(`end tied ${String(fight.tied)} prompt ${String(prompt.radius)} ${prompt.label} player ${String(player.x)},${String(player.z)}`);
      return log;
    };
    expect(run(true)).toEqual(run(false));
  }
});
