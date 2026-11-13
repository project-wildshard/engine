# AUDIO AU16: one engine music style (J304)

- opus-au16. Jake (J304, ~22:00 Cancún): one music style per shard, the others go. Every shard plays piano (meta
  AUDIO-PLAN AU15), so the engine drops the Settings music-style choice and the folk and orchestral styles.
- `git rm` `public/assets/music/{folk,orchestral}/` (14 files, 4.31 MB); the boot tables regenerate without them.
  Shard-side folk and orchestral copies (Driftwood's and Pine's tension stems, `pine-hollow-{folk,orchestral}/`)
  stay until AU17's shard revisions.
- `bootAudio.ts`: `ENGINE_MUSIC_STYLE = 'piano'` replaces `MUSIC_STYLES` and `DEFAULT_MUSIC_STYLE`; the selection
  and the cook list one style. `Settings.ts` drops `musicStyle` (an old save's value is ignored and dropped on the
  next save); `musicStyleRow.ts` goes. `Music.ts` keeps the synth only as the fallback when a recording fails.
- A score set's decoded slots were tagged genre `'folk'` (lift-era); they are tagged `'score'` now so they still
  never match the engine style's bank, the behaviour piano players had.
- Commit 2: bootAudio.ts and the cook's pack list read ENGINE_MUSIC_STYLE; the per-style lists go.
