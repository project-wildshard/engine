# 2026-11-13 Open Plot audio on the grid (AUDIO AU20)

- An Open Plot on the grid page is a bodyless data cell (no runtime, no
  declared client page), so no entered hooks ran there and its client
  plan's `audio.scene` never installed: AU14 heard Saltwind Lighthouse
  silent on the music and ambience buses after a cross-in from Pine.
  Both grid routes (preview's in-page grid, the online world grid) share
  `LiveGridSession`'s data-cell admission, so both were silent.
- `grid/plotAudio.ts`: while the feet stand in such a cell, the grid binds
  its declared scene (director, score, bed, loops, wind input) to the
  page mixer and drops it on leave. The bank is a play-time read on entry
  (never LOAD; Pine's DOWNLOAD stays Pine's), one per resident cell.
  `Audio.lendLevelBank` gives the replaced bank back after the director
  unbinds (claude -p review).
- Proof: `audio-download-proof.mjs --target=preview
  --entry=open-plot-saltwind-lighthouse:cross` green warm and slow.
