# Row 56, part two. A return's redial is quiet, and one dial

The Coordinator's call at 21:14 Cancún: a reconnect that follows a resume
(visibilitychange or pageshow) is quiet whatever its length. It shows only
if the redial fails or passes 30 s. They also asked why the resume redial
took about 9.7 s.

## Why 9.7 s

I ran the iOS Simulator on staging v0.1.53: two minutes in Settings, then
back to Safari. Welcome back sat over play for 9.7 s. The staging server's
log for that guest shows three `client.device` words, at 02:13:30.5, 33.9
and 37.1 UTC. A page sends that word only after the door's `world` word,
so the door answered all three dials.

Nine Dragon's worker stats show the dials getting seated:

- **02:13:26:** a player seated.
- **02:13:36:** that player held. A seated socket was closed by the
  client.

The server sent frames. The client dropped each dial at Redial's 3 s
first-frame deadline (DROP_MS) and dialled again from scratch. Each dial
needed 2.3 s just to send its device word, so the page was slow for
seconds after the long suspend. With the door's save read and seating on
top, 3 s was not enough. The third dial fit.

## The change

**`redial.ts`:**

- A dial the world has answered gets 10 s (ANSWERED_MS) to carry its first
  frame. "Answered" means any door word, through a new optional `answered`
  hook that the shell wires to the socket's controls.
- A dial with no answer keeps 3 s.
- The page's own freeze no longer counts against a dial in flight. SB31
  already did this for a live link.

**`linkScreens.ts`:**

- An outage that is down at the return, or starts within the 5 s grace,
  is the return's outage.
- It stays quiet, with no banner, no Welcome back card and no Reconnected
  notice, until either:
  - a second dial goes out (the first one failed), or
  - 30 s pass since the return.

  Either way, the once-a-second check shows the banner or opens the card.
- On iOS, the page's clock can see the drop before the visibility event
  fires. Anything painted in that window was never seen, so the return
  takes it back.

## Proof

The tests replay the staging case. Back from 2 minutes, the world
answers at 2.4 s and the frame comes at 4 s:

- **With `answered`:** one dial, live.
- **Without it:** dropped at 3 s, as before.

They also cover a 9.7 s return that stays quiet, the banner at 30 s, a
second dial showing it at once, Welcome back held then opened, and the
iOS event order.

A live Simulator re-run on the next staging release is still owed.
