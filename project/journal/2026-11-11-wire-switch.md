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
