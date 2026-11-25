// The alpha 2 trailer (meta ALPHA-2-TRAILER AT10; the creative calls are meta J520). About a minute at 16:9, every frame in
// engine: it opens on play, the title follows the first shot, and play and build interleave (each build beat is a real Claude
// Code session, then play where it was built), a party of three, a crossing over a cell seam, and the grid pull-back ends
// it on the end card. Timed to the score take's hits (music_scan.py): take 501 at 148 bpm, cut once by six bars so its
// last hit lands on the pull-back.
//
//   node scripts/trailer/cut.mjs <cut> <minimax3-501.wav> <sfx best> --cut alpha-2 \
//     --bug <titles>/a-bug/000000.png --build-1 beat-wyrm.mp4 --build-2 beat-salt.mp4 --build-3 beat-nine.mp4
//
// The zones (J520: the best 6 or 7 of the 10, each in its best light): Driftwood Isle, Nalati Grasslands, Brasscap Mesa,
// Signal Dunes, Sky Reach, Mirror Salt and Nine Dragon Stack. Pine Hollow (hazy at HEAD), Glowfen (too dark to read at
// trailer size) and Mossgate (its wide views break up) were scouted and left out.

/** the score: take 501 from 0 to 52.3 s, then from 62.03 s (six bars on), so its 64.77 s hit lands at 55.04 s */
export const SCORE = { cut: 52.3, resume: 62.03 };
/** a time in the take → a time on the cut @param {number} t */
export const onCut = (t) => (t < SCORE.cut ? t : t - (SCORE.resume - SCORE.cut));

/** @param {{ TAKE: string, SFX: string, bug?: string, 'build-1'?: string, 'build-2'?: string, 'build-3'?: string }} o */
export function cut(o) {
  const beat = (/** @type {string} */ k) => { const v = o[/** @type {'build-1'} */ (`build-${k}`)]; if (typeof v !== 'string') throw new Error(`alpha-2: --build-${k} <mp4> is required`); return v; };
  /** [shot, dur, zone, extra] in order; `at` is the running sum */
  const plan = /** @type {[string, number, string, Record<string, unknown>?][]} */ ([
    ['d-walk', 3.67, 'driftwood-isle'],                       // play opens: up the beach
    ['d-open', 4.82, 'driftwood-isle', { in: 0.1 }],          // 3.67 hit: the title over the isle
    ['n-run', 2.6, 'nalati-grasslands', { in: 0.5 }],         // 8.49 hit
    ['d-party', 2.9, 'driftwood-isle', { in: 0.4 }],          // three other players on the beach head
    ['d-combo', 2.6, 'driftwood-isle'],                       // a fight: the boar herd on the beach
    ['build-wyrm', 4.6, 'seat', { video: beat('1') }],        // built: Brasscap's Dust Wyrm session
    ['b-bandits', 3.41, 'brasscap-mesa', { in: 0.3 }],        // played where it was built: a fight at the bandit camp
    ['g-cross', 4, 'nalati-grasslands'],                      // 24.6 hit: over the seam, no loading panel
    ['dn-caravan', 2.5, 'sunscar-dunes', { in: 0.5 }],        // the caravan camp at sunset
    ['sr-bridge', 2.6, 'far-reach', { in: 0.6 }],
    ['build-salt', 4.4, 'seat', { video: beat('2') }],        // built: Mirror Salt into the engine
    ['m-yachts', 2.2, 'mirror-salt', { in: 0.8 }],
    ['m-run', 2.01, 'mirror-salt', { in: 0.6 }],
    ['nd-rise', 2.79, 'nine-dragon-stack', { in: 0.3 }],      // 42.31 hit
    ['build-nine', 4.2, 'seat', { video: beat('3') }],        // built: Nine Dragon's look pass
    ['nd-wide', 3, 'nine-dragon-stack', { in: 0.3 }],
    ['g-plots', 2.74, 'driftwood-isle', { in: 0.6 }],         // the open plots, waiting for builders
    ['g-rise', 5.6, 'driftwood-isle', { in: 0.2 }],           // 55.04 hit: the grid pull-back
    ['black', 2.36, 'none'],                                  // the end card holds
  ]);
  let at = 0;
  /** @type {Record<string, any>[]} */
  const clips = [];
  for (const [shot, dur, zone, x = {}] of plan) {
    clips.push({ at: Number(at.toFixed(3)), shot, in: 0, dur, zone, ...x });
    at += dur;
  }
  const LEN = Number(at.toFixed(3));
  const when = (/** @type {string} */ shot) => { const c = clips.find((k) => k.shot === shot); if (!c) throw new Error(shot); return c.at; };
  const third = (/** @type {string} */ shot, /** @type {string} */ name, /** @type {string} */ sub, d = 0.25) => ({ id: `lt-${shot}`, card: 'shard', at: when(shot) + d, dur: 2.3, kicker: 'Zone', name, sub });
  const titles = [
    { id: 'title', card: 'alpha', at: when('d-open') + 0.25, dur: 4.2, kicker: 'Project Wildshard', bigHtml: 'Alpha <b>2</b>', sub: 'Captured in engine · everything here is work in progress' },
    third('d-walk', 'Driftwood Isle', 'An island at the middle of the grid', 0.4),
    third('n-run', 'Nalati Grasslands', 'The steppe, east of the isle'),
    third('b-bandits', 'Brasscap Mesa', 'Built in its own repo with Claude Code', 0.15),
    { id: 'cap-world', card: 'bigcap', at: onCut(26.21), dur: 2.4, text: 'An MMO whose world is built by its players' },
    third('dn-caravan', 'Signal Dunes', 'The desert, west of the isle'),
    third('sr-bridge', 'Sky Reach', 'Islands above the clouds'),
    third('m-yachts', 'Mirror Salt', 'Built in its own repo with Claude Code'),
    third('nd-rise', 'Nine Dragon Stack', 'A city stacked up a mountain'),
    third('g-plots', 'Open plots', 'Fifteen cells waiting for their builders', 0.15),
    { id: 'end', card: 'endA', at: when('g-rise') + 2.8, dur: LEN - (when('g-rise') + 2.8), cta2Html: 'Build your own zone <b>with Claude Code</b>', alpha: 'Alpha 2 · captured in engine · work in progress',
      credits: 'Music: MiniMax-Music3 &nbsp;·&nbsp; Sound effects: MOSS-SoundEffect v2 · Stable Audio 3 — Powered by Stability AI &nbsp;·&nbsp; Captured in engine &nbsp;·&nbsp; Built with Claude Code' },
  ];
  // the corner bug on every frame but the end card's hold (which carries its own alpha line)
  const overlays = typeof o.bug === 'string' ? clips.filter((c) => c.shot !== 'black').map((c) => ({ png: o.bug, from: c.at, to: Number((c.at + c.dur).toFixed(3)) })) : [];
  const hits = [0.89, 3.67, 8.49, 24.6, 26.21, 42.31, 64.77].map(onCut);
  const mix = {
    length: LEN, sfxdir: o.SFX,
    music: { file: o.TAKE, segments: [[0, SCORE.cut, 0], [SCORE.resume, 70.08, SCORE.cut]], gain_db: 0, fades: [[0, 0.05, 'in'], [LEN - 2.2, 2.2, 'out']] },
    beds: [],
    events: [
      { sound: 'game:footstep-sand', at: 0.4, gain_db: -14 }, { sound: 'game:footstep-sand', at: 0.85, gain_db: -14 }, { sound: 'game:gull', at: 1.6, gain_db: -12 },
      { sound: 'tr:reverse', at: hits[1] - 1.8, gain_db: -10, peak: 1.88 }, { sound: 'tr:braam', at: hits[1], gain_db: -7 },
      { sound: 'tr:whoosh', at: hits[2], gain_db: -12, peak: 1.34 }, { sound: 'game:hoof-grass', at: hits[2] + 0.6, gain_db: -12 },
      { sound: 'game:footstep-sand', at: when('d-party') + 0.5, gain_db: -15 },
      { sound: 'game:swordSwing', at: when('d-combo') + 0.25, gain_db: -9 }, { sound: 'game:swordHit-flesh', at: when('d-combo') + 0.33, gain_db: -9 }, { sound: 'game:boar_squeal', at: when('d-combo') + 0.4, gain_db: -11 },
      { sound: 'game:swordSwing', at: when('d-combo') + 0.65, gain_db: -9 }, { sound: 'game:swordHeavy', at: when('d-combo') + 1.4, gain_db: -9 },
      { sound: 'tr:whoosh', at: when('build-wyrm'), gain_db: -14, peak: 1.34 },
      { sound: 'game:rifleFire', at: when('b-bandits') + 0.05, gain_db: -7 }, { sound: 'game:rifleFire', at: when('b-bandits') + 0.9, gain_db: -7 }, { sound: 'game:rifleFire', at: when('b-bandits') + 1.75, gain_db: -7 }, { sound: 'game:rifleFire', at: when('b-bandits') + 2.6, gain_db: -7 },
      { sound: 'tr:riser', at: hits[3] - 4.6, gain_db: -12 }, { sound: 'tr:impact', at: hits[4], gain_db: -6 },
      { sound: 'game:footstep-sand', at: when('dn-caravan') + 0.4, gain_db: -15 },
      { sound: 'game:footstep-planks', at: when('sr-bridge') + 0.3, gain_db: -13 }, { sound: 'game:footstep-planks', at: when('sr-bridge') + 0.75, gain_db: -13 },
      { sound: 'tr:whoosh', at: when('build-salt'), gain_db: -14, peak: 1.34 },
      { sound: 'tr:braam', at: hits[5], gain_db: -8 },
      { sound: 'tr:whoosh', at: when('build-nine'), gain_db: -14, peak: 1.34 },
      { sound: 'tr:riser', at: hits[6] - 4.6, gain_db: -11 }, { sound: 'tr:impact', at: hits[6], gain_db: -5 }, { sound: 'tr:subdrop', at: hits[6] + 0.1, gain_db: -9 },
    ],
  };
  return { edl: { length: LEN, clips, titles, overlays }, titles, mix,
    report: `${clips.length} clips over ${LEN.toFixed(2)} s, ${titles.length} cards, ${mix.events.length} sound events; hits on the cut at ${hits.map((h) => h.toFixed(2)).join(', ')}` };
}
