# Voice: proximity and the talking ring (VOICE-POLISH V7, V8)

> Written by: Claude (opus-voice), 2026-11-11

Voice was cell-wide: anyone on voice in a cell heard everyone, at full volume. V7 makes it fade with distance and go
silent from 40 m, which J218's design called for once the public grid makes strangers likely. V8 puts a ring over the
head of whoever you hear talking, so you can tell who it is without opening chat.

The link between a voice peer and a body is the Name. The relay's voice id is random and the main thread never knows
an entity handle, so the only thing both sides already carry is the seat's Name (the relay's roster and the player row's
`name` are the same string). That keeps the wire as it is (opus-wire owns the codec). Two players with one Name: the
nearer body speaks for both, which only ever makes someone louder, never wrongly silent.

`src/client/engine/net/voiceNear.ts` is the meeting point: `OtherPlayers` lends distances, `VoiceChat` reads them every
150 ms poll and publishes the Names it hears talking. Links stay up past 40 m, so walking back in is heard at once; a
far peer is muted on its element and its chip says "too far". iOS Safari ignores `HTMLMediaElement.volume`, so on an
iPhone the fade is full-or-nothing at 40 m; only the cutoff is exact everywhere.
