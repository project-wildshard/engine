# Device telemetry (opus-devicetel)

- Jake, 13:40 Cancún: a friend won't say what Android phone he has, so gather device metadata for every client that connects, in
  the MMO door and in Sentry. Plan: meta `docs/plans/DEVICE-TELEMETRY-PLAN.md`.
- The hello is `@wildshard/wire`'s binary handshake, so the snapshot rides a new socket control word (prefix 10) instead. An old door
  closes `refused` on an unknown prefix, so the door now says `device: 1` in its first `world` word and a client sends only after
  hearing it. Old client to new door and new client to old door both join as before.
- The word must stay under the room's 1024-byte message cap (bigger closes the socket), so it is capped at 1000 bytes and sheds the
  least telling fields first; model and GPU stay.
- The GPU note lives on `globalThis` under a `Symbol.for` key: the online shell and the game may be separate engine bundles.
- Sentry: the `device` context and `device.*` tags ride the lazy SDK load, so the title pays nothing, and only errors carry them.
- No admin view: the door has no ADMIN_TOKEN area and `/health` is public by design, so the journal line is the read path
  (`scripts/devices.mjs`).
