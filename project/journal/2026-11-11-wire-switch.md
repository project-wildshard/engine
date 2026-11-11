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
