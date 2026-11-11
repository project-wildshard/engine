# Voice: Settings ▸ Voice and hold to talk (VOICE-POLISH V10, V11)

> Written by: Claude (opus-voice), 2026-11-11

Voice had one control, the mic toggle, with `B` hard-wired in voiceUi.ts. V10 adds a Voice group to Settings ▸ Sound
(SR11's tabs): the microphone, how loud the other players are, and on a keyboard whether the talk key toggles or is held.
The key itself became the `voice.talk` action on foot, so it rebinds in Controls ▸ Key bindings like any other key; a
Voice chat ▸ Talk row shows there in builds of the online world only, as the Voice group does (single player has no
voice, and Jake asked for no voice talk there).

V11 is the hold mode. Holding the key joins voice if need be and opens the mic; letting go disables the mic's track,
which sends silence, while the player stays on voice and hears everyone. The mic button stays the tap toggle for
joining and leaving. A key let go in another window still closes the mic (blur and a hidden page release it). Hold
mode is a keyboard thing, so a phone's Settings shows only the microphone and the volume, with a line on tapping the mic.

A new microphone picked mid-call is swapped into every link's sender with `replaceTrack`, no renegotiation; a saved mic
that is gone falls back to the default rather than failing the join. Volume multiplies V7's distance fade.
