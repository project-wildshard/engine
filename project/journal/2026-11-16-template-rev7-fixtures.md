# Template rev 7 fixtures, main green (buddy-engine)

- My rev 7 pin (0445210e) went to main with four Template tests still
  on rev 6's content (opus-gcm12 reproduced them on a650b207). The
  touched tests I ran before pushing read the pin files, not the
  Template kit, and the push gate's related set missed these four.
- None is an engine bug; each change was checked against rev 7's own
  rows:
  - declared-kit-items: rev 7's loadout is the whip and the lantern;
    the iron sword hangs on a rack (`template.rack.use` at [1, 1, -12],
    TC-M5b). A swap to its slot is now spent until the rack's prompt
    puts it in hand, then the sword's heavy kills the blob as before.
  - declared-rack-melee: "no rack take" now drops rev 7's own
    `template.rack.take` along with the fixture's.
  - net-status-effects: rev 7 brings striking creatures to the spawn
    yard (grey-blob:3 at [8, 0, 2]; the bog-wisps orbit [-19.4, 0],
    noticing at 18 m). The watcher stood 3 m from spawn and took 12
    damage before the poison and 8 more during it. It now stands 20 m
    south, at full health; every poison number is unchanged.
  - side-parity: the `_template` page half re-recorded from the
    production bundle (590 colliders; the south gate and lever are new
    in rev 7). Page and room agree.
- Lesson: a Template pin bump runs the Template tests (`grep -l
  "'_template'" test/`), not just the pin readers.
