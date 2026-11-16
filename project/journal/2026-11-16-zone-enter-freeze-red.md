# Main red on the zone-entry freeze: a thaw, not a drift (buddy-engine)

- Main ci 43961757496 on fe991ad7: `dedicated-zone-enter`'s first case
  failed `frozen: inputs move nothing` with 0.0706 m against 0.05.
- Not a regression from that range. Nothing in it touches the road, the
  door or the bot's client: SB31's `016d7c4a` changes the page's
  `redial.ts`, which `RoomBot`'s `NetClient` never imports. The five
  main runs before it passed the same server code.
- About 25 local runs of the red version and of main's current one gave
  exactly 0.000 m: alone, six at once under CPU burners, frozen mid-jump
  and frozen pressed against the gate. A frozen body doesn't creep.
- What does give 0.07-0.18 m: lifting the freeze in the window's last
  20-50 ms, so the next tick's sprint shows up as a few centimetres. So
  the likely story is something thawed the seat late on a slow runner.
  The door thaws on `busy`, a ready timeout, a redial or a refused move,
  and the page hears a refusal for most of them. Which one it was isn't
  in the log.
- So the case now samples whether the road still holds the freeze, and
  checks that, then the door's answers, before the drift. Each failure
  message carries the answers, socket closes and any sample that moved.
  A late thaw now fails as itself (checked by thawing at 1.48 s by
  hand). If it comes back, the message names the door's reason.
