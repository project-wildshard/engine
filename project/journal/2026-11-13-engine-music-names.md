# 2026-11-13: a shard names its engine music, the cook derives the files (AUDIO AU18)

- J304: one music style (piano). A shard's audio rows already name the engine music they play: the `title` boot slot,
  each score slot set to `base`, and each extra sting with no set of its own (`engineMusicNames` in
  `shared/engine/audio/bootAudio.ts`, reading the rows as shard-format v0.4.4's `engineMusicSlots` does).
- The cook derives the hashed files from those names through AU1's `defaultBootAudio` and now refuses a shard naming a
  slot or sting the piano manifest lacks, or ships without its files; before, the selection dropped it through
  `shipped` and the shard played the synth with no warning. The build logs `<shard>: engine music: N files, X MB`.
- Derived today: Driftwood and Pine 6 files (title, their slot's calm and tension, 3 stings), Nalati 4, Nine Dragon and
  the Open Plots the title only, Dunes and Far Reach none. `test/engine-music-names.test.ts` also pins the piano
  manifest's slots to shard-format's `ENGINE_MUSIC_SLOTS` plus `title`.
