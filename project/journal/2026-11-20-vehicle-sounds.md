# Vehicle sounds (MIRROR-SALT-ZONE MSZ15)

> Written by: Claude (mini-msz15)

- Vehicles now sound on every page that follows them (scene page, data page, grid cell): an engine loop pitched and
  levelled by speed and throttle, a skid on a slide (on at 2 m/s across the heading, off under 1.2), one impact a hit, the
  horn while held (new `vehicle.horn|<id>` state row), and a wind rush for the rider past 20 m/s (off under 18).
- Sources: a kind's `sounds` slots name `audio.cues`; a cue whose voice is a declared recording plays that recording
  (read through the page's product reader, decoded on the page's context); an `impact-*` voice plays the procedural
  material voice. Slots left out play an engine synth (`vehicleSynth`, crossfaded loops), a hit `impact-wood`.
- Decided: a sail declares its luff as `loop` and its creak as `skid` (the format has four slots, no format release for
  two more). Decided: other players' vehicles read their motion from drawn poses over 0.1 s windows; a hit is a velocity
  change past 5 m/s heard once at its peak. A per-frame read made every held interpolation frame a crash.
- The headless report is the audio trigger log: `vehicle.loop`, `vehicle.skid`, `vehicle.skid.end`, `vehicle.impact`
  (with strength and source), `vehicle.horn`, `vehicle.wind`, `vehicle.sample`.
- QA 2026-11-19 row 32 (Mirror Salt's broken race and collision sounds, codex-netlag) is untouched: vehicle impacts use the
  procedural voices, not the sampled path that row is about.
