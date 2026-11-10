# FM4: the link's screens (meta MMO-FAILURE-MODES-PLAN)

Lane opus-failmodes2. Jake approved the failure-modes plan ("build it
and fix forward"); FM4 wires the link's screens to `Redial` and the
online shell, replacing the plain strip and the raw error text.

- `src/client/host/online/linkScreens.ts`: the banner (a tab in the
  top band, keeping the old `#ws-reconnect-strip` id), the Reconnected
  notice, the cards (`lost`, `full`, `replaced`, `refused`) and the
  hold card a tap opens while the banner is up. Each root carries the
  catalogue's `data-failmode` ids; 1006 can't tell a drop from a
  reset, so that banner says `drop reset` (proofs match with `~=`).
- `Redial` gains `why` (closed, restart, silent, hidden) and
  `progress` (dials, next dial, time down), and passes the cause as
  `onState`'s reason. Its timing is unchanged.
- `NetClient.gateActions`: the shell refuses an act (interact, buy,
  equip, ...) and `NetPlayer` refuses a swing, ability or shot while
  the link is down. The hold card says why. Before this a press made
  while the predictor was full stayed set and went out late.
- Chat typed while down is held, shown as unsent, and sent in order
  on the first frame back; Don't send it drops it.
- "The server closed this link (refused)." is gone: `refused` and any
  other unknown ending get the turned-away card; `replaced` gets Play
  here. `reload` still reloads once (J174), as before.
- Proof: `test/online-link-screens.test.ts` (happy-dom),
  `test/net-redial.test.ts`'s cause and progress cases, and the
  browser proof `test/net-strip-browser.test.ts` now taps during a
  real pull and checks the hold card, the held chat line and the
  Reconnected notice. FM3's chaos proof will cover the rest.
- `restart-blocked` from the title and `deploy-blocked` need the title
  to know the world's state before a link exists; they wait for that.

## J206 review fixes (Codex, NO-GO on f139385)

- An equip asked while down was kept and sent after recovery; now it
  is refused and the hand goes back to what the server holds.
- A held melee press (`press(false)`) is a real attack: it is gated as
  Attack too, and the card's quiet spell stops repeat prompts.
- Cards release desktop pointer lock, so their buttons can be clicked.
- `Redial.onCause`: a restart close mid-dial, or a return to the tab
  after a silent spell, now repaints the banner. Timing is unchanged.
- Try again on the lost card hands back to the banner; one notice at a
  time, gone when the link drops again; the stylesheet outlives a
  shell; chat after the world ended is not held.
