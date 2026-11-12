# Template rev 2 pin: Mossgate v3 (opus-eng17)

- Meta ENG-17, J279 "Mossgate LUT ships". Engine pins `template`
  revision 2 (`169ae525…`, 8,239,616 bytes, v0.2.1, built from sharddev
  `54ec2c4`, uploaded by opus-slot). Brasscap's live rev 2 stays unpinned
  here: its bump is its own lane.
- The released v0.1.1 Template save cannot resume on it. Mossgate v3
  changed the level, so the save's level fingerprint no longer matches
  and the engine refuses the whole world snapshot ("Incompatible
  simulation snapshot"). That is the designed path, not a bug: the
  standalone grid sets a refused world aside, opens a fresh one and
  carries the player's progress (`openCellWorld` `adopt`). J190 wiped
  progress at the first engine build and J174 promises progress, not
  fights or world state, across a deploy. The save epoch stays 1:
  progress documents did not change.
- So the fixture is re-cut, not deleted: `test/pins/saves/template.json`
  now names the pin as `refused`, and `released-save-play` proves that
  pin refuses the save with exactly that error. The bytes stay as
  provenance. A later pin move fails the pin check, so a lane decides
  again.
- Ring 1's template digest chain re-recorded (`b039e3fa…`); every other
  ring shard is unchanged. Darwin and Linux carry the same chain, as
  they do for every row.
- Headless Chromium boot of `?chunk=_template` on a local build: the
  page serves rev 2's validation, Mossgate hut on screen, 0 page errors,
  0 console errors, 0 HTTP errors.
