// A two-clip smoke cut (meta ALPHA-2-TRAILER AT2): two held dry stills from capture.mjs --dry (driftwood-isle's d-open and
// d-pier), a caption, the game's own sounds on the cut and the score under it. It proves the chain end to end:
//   node scripts/trailer/cut.mjs <cut> <take> <sfxDir> --cut test
//   node scripts/trailer/titles.mjs <titles> <cut>/titles.json
//   python scripts/trailer/mix.py <cut>/mix.json <mix.wav>
//   node scripts/trailer/edit.mjs <dry frames> <cut>/edl.json <titles> <mix.wav> <out.mp4>
/** @param {{ TAKE: string, SFX: string }} o */
export function cut({ TAKE, SFX }) {
  const LEN = 6;
  const clips = [
    { at: 0, shot: 'd-open', in: 0, dur: 3, still: '000150.jpg', zone: 'driftwood-isle' },
    { at: 3, shot: 'd-pier', in: 0, dur: 3, still: '000120.jpg', zone: 'driftwood-isle', flashIn: 0.12 },
  ];
  const titles = [{ id: 'cap', card: 'caption', at: 0.4, dur: 2.4, kicker: 'Smoke cut', text: 'Two held stills, captured in engine' }];
  const mix = {
    length: LEN, sfxdir: SFX,
    music: { file: TAKE, segments: [[0, LEN, 0]], gain_db: 0, fades: [[0, 0.3, 'in'], [LEN - 1.2, 1.2, 'out']] },
    beds: [],
    events: [
      { sound: 'game:splash', at: 0.8, gain_db: -8 },
      { sound: 'tr:whoosh', at: 3, gain_db: -8, peak: 1.3 },
      { sound: 'game:footstep-planks', at: 3.6, gain_db: -10 },
    ],
  };
  return { edl: { length: LEN, clips, titles }, titles, mix, report: `${clips.length} clips, ${mix.events.length} sound events` };
}
