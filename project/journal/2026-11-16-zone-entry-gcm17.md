# Zone entry, opus-gcm17 (2026-11-16)

- ZE10d2: the online half of the same-page zone entry. World builds kept the fresh page
  because nothing on the page said `enter`: ZE9's door half was there, the page's was not.
  Now the gate's 0 asks the running session's online shell (`grid/onlineGate.ts`), which
  says `enter` and, on `arrive`, holds the NetClient (the road's frames name the cell left).
  The session ends with no quit; the next session on the page adopts the shell
  (`StartedOnline.adopt`, `rehome`) and its `ready` is the door's go. One socket throughout.
  Red first: `test/online-zone-enter.test.ts` (Sunscar same worker, Nalati other worker,
  and a refused enter). Rig proof: `scripts/zone-gate-rig.mjs` runs
  `zone-gate-proof.mjs --online`.
- The held link was dropped by the redial's 3 s watch (no decoded frame while held): a
  held frame now counts as heard (`NetClient.onHeldFrame`). Found on the local rig, where the
  redial went on into the cell as ZE9c's goto and the old shell re-entered on a fresh page.
- ZE16 on the bench: the gate-frozen body vanished from everyone else's view. The zone-freeze
  catch-up fix parked the body, and parked players are never visited for the wire (J109's
  practice rooms). A gate freeze is now parked and `shown` (`SimHost.shown`), so B on the
  road keeps seeing A stand at the gate until it goes; C in the cell sees A arrive.
- Rig proof passes desktop and phone (build 86447e7df). The one `claude -p` review then found two
  MUSTs, both fixed with tests: a refusal after `arrive` (no `ready` in the door's wait)
  left the client held for good, so the shell now hears it, lets the hold go and regrids
  to the cell left; and the page's cell moved only at `adopt`, so a redial in between
  regridded the old session mid-entry. The cell, `loaded` and the dial's goto now move at
  `arrive`. A hold waits for its cell's welcome (another cell's ends it and regrids), a
  handed-over link no session takes goes after 130 s, and `removePlayer` clears parked/shown.
