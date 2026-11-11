# The game onto wire v1 (WIRE-STABILITY WR5), opus-wire

- Engine pins wire at shardfile a51f56f, the codec WB2 measures.
- `net/wireValues.ts` says the game's events the wire v1 way and back
  (vectors as x, y, z structs, absence for null, class ids from 1). A test
  sends every event form through the wire codec and checks it reads back as
  the v0 codec reads it, to 9 places (the wire's quantised decode differs
  from v0's in the last ulp). Next: the room and client switch over.
