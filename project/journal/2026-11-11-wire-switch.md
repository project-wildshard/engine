# The game onto wire v1 (WIRE-STABILITY WR5), opus-wire

- Engine pins wire at shardfile a51f56f, the codec WB2 measures.
- `net/wireValues.ts` says the game's events the wire v1 way and back
  (vectors as x, y, z structs, absence for null, class ids from 1). A test
  sends every event form through the wire codec and checks it reads back as
  the v0 codec reads it, to 9 places (the wire's quantised decode differs
  from v0's in the last ulp). Next: the room and client switch over.
- Commands and acts too: `toWireCommand`/`fromWireCommand` (the high
  button byte apart, targets as handles, an unknown handle refuses as v0
  did) and `toWireAct`/`fromWireAct`. Every command and act form sent
  through the wire codec reads back as v0 reads it.
- Frames: `net/wireFrames.ts` says a FrameInput as the wire's snapshot
  input (server), and `WireFrameReader` reads a frame in the sender's
  layout, keeps that raw frame as the next baseline (5.4) and projects it
  into this build's layout as the DecodedFrame the predictor and the
  interpolator already read. A sequence with a whole frame, a delta, a held
  row, a gone row, the owner block and a ride decodes to exactly what v0
  decodes, owner f64 bytes included.
- `net/wireMessages.ts`: the game's messages on wire v1 in its own values
  (hello with the client's tables, welcome with the server's and their
  hash, events, commands, acts), plus `WireClientReader`, a client's
  command and act codecs compiled once from its hello, and the client's
  events reader over the server's event tables and spawn columns.
- The switch: the room, the client, the dedicated door and the doctor now
  speak wire v1. The room reads a client's bootstrap and hello, compiles
  that client's command and act codecs from its tables, and sends welcome,
  events and frames the v1 way; the client builds its frame and event
  readers from the welcome's tables. J54's build-equality refusal is gone
  (room and door): a v0.1.x hello or an older major gets `reload`, a newer
  major or a minor two ahead gets `retry`, another build of this wire plays.
  Tests that spoke v0 bytes to a room now speak v1; the stale-build tests
  became refusal-policy tests.
- The refusal policy as a client sees it (5.5): `retry` from an older
  server shows "Server updating" and dials again, never reloading. A
  `reload` or `refused` before any frame is the cut (a v0.1.x server can't
  read a v1 hello): the link keeps dialling as Server updating, and the
  page reloads only when version.json names another build. After the first
  frame, `reload` still ends the link as before.
- The WR3 and WR4 review items carried here: quantiseCommand steps exactly
  what the v1 command codec delivers (every axis word in the domain, pitch,
  yaw and launcher ads swept against the codec and v0); a sender with an
  extra owner field before px projects px..vz bit for bit through
  WireFrameReader (J140); and a room with required capabilities refuses a
  hello lacking one before play, with `reload`. The server compiles one
  client's codecs per hello and caches none across clients, so the LRU cap
  the review asked for has nothing to bound yet; a shared cache would need
  one.
- Codex review of the branch (J206), its five MUSTs folded in with a
  regression each (`test/wire-review.test.ts`): reliable events now split
  into messages under the wire's 64 KiB cap, in order (v0 had no cap); the
  client keeps every spawned handle's sender class id, so a class this
  build lacks decodes and is left out of the projection instead of
  blocking the frame; spawn text projects by field id; a frame record after
  another record in one message applies (the reader takes the record's
  span); and a welcome whose tables this build can't project closes as
  `reload` instead of leaving the client unwelcomed. SHOULD: a room checks
  its required capabilities on a traveller too. NIT: the doctor says an
  accepted hello proves wire compatibility, not the same build.
- Hosted CI caught the door tests: the dedicated gateway fixture still said
  hello the v0 way, and four tests expected a wrong build to reload. They
  now hold 5.5: a v0.1.x hello reloads, another build of this wire plays
  (or meets a full world, as the right build would).
- WR6, engine's half. `@wildshard/wire-released` is the wire at the last
  release (shardfile `669d1fc` until `wire-v1.0.0` exists), installed
  beside the bound wire; its lockfile entry keeps `path` by hand like the
  bound one, and `wire-lockfile.test.ts` now guards every wire entry. Both
  copies are `@wildshard/wire@0.0.0`, and TypeScript types one package as
  the other when it resolves both, so the harness loads the released copy
  by a specifier TypeScript never resolves, typed as the bound one's.
  `test/contract-cross.test.ts` plays a released-wire client against the
  real Sunscar room (hello, spawns, 30 frames with a lost ack, its cmds
  driving the room) and this engine's NetClient against a released-wire
  room a minor ahead (an animal field it lacks first, a kite class, an
  unknown record, owner f64 bits, rides). `check:wire` runs the bound
  wire's `wire check` (a pin-sanity check at `a51f56f`: the installed
  lock equals its descriptors and holds against v0; the release rules
  come with a newer pin) in pre-push static checks and CI static, by the
  package's own `bin.mjs`: both copies declare a `wire` bin, so
  `node_modules/.bin/wire` could link either.
- The WR6 Opus review (one-shot): MUSTs folded. The released client's
  frames are now read beside the bound wire and must match word for
  word, the room's stepped yaw and buttons must be what it sent, and the
  HEAD client's hello, cmds and chat act are read by the released codecs
  as the bound ones read them. Also folded: a room at the release's own
  tables as well as one a minor ahead, a chat act and a clean close both
  ways, the released-copy guard in `beforeAll` (its path names
  `669d1fca`), and one lockfile entry per wire pin. Carried to the plan:
  shardfile's `inSourceRepo` throws from a copy nested in another repo,
  so `wire check` fails in engine once engine pins past `5139b41`; and
  engine could apply the release rules against the released copy's lock.
