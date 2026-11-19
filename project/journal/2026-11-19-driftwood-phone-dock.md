# The iPhone 13 at Driftwood's dock (meta IPHONE13-DRIFTWOOD DW1, DW3; DRIFTWOOD-FPS DF8)

> Written by: Claude (lane mini-driftwood13)

The MacBook's opus-fps asked three things of the phone at Driftwood's dock: does the Memory saver purge and re-upload,
do live Web Audio sources climb (Jake's 17 Pro video: 4 to 42 in 12 s), and what links after control. The route bench
now reads each second's texture and buffer uploads, buffer read-backs, live audio sources and the mem chip, so one walk
answers all three. On the phone, the first answer is no: no read-backs, textures only rise.

The phone locked once between runs with Auto-Lock off, and nobody knows why. The bench now logs lockState around every
proxy start, Safari launch and boot, and stops on a locked phone. It also holds a Screen Wake Lock: iOS 18.6 refuses one
asked from Web Inspector unless the evaluate carries `emulateUserGesture`, and then grants it.

DF8: on iOS a program link is a synchronous 77 ms or more, and Driftwood linked 32 programs in its first seconds of play,
the road variants and undrawn materials the boot leaves for later (S1). The slot `debug.bootRoadPrograms` links them in
the boot's world-frame stage, under the card. On desktop WebKit, control came no later and 25 of those 32 links moved
before it. It stays off until the phone pairs weigh the longer card against the dock's spikes.

The slot landed separately from the bench: `debug.bootRoadPrograms` in render/precompile.ts, read in session/finish.ts at the
world-frame stage, with Game.warmDeferredEntryRoots taking an unpaced run for it.

Later the same evening: moving the links under the card did not move the dock's first-4-s spikes on the phone. A
MessageChannel ping loop showed 190 to 540 ms main-thread tasks between frames, and a Web Inspector ScriptProfiler sample
named them: half the main thread in `new WebAssembly.Memory`, the grid page's script memory top-up after control
(scriptMemoryPlan.ts, SB47). The slot `debug.scriptMemoryTopUp` (default on) can skip it; the phone pairs decide.
The bench gained `--ab <slot>` (ABBA pairs in one process), `--cool-to`, `--legs`, `--profile <s>` and a per-second busy gap.
