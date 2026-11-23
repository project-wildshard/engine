# SP1b5a: the recorder port

> Written by: Claude (opus-compat-w6), 2026-11-23

SP1b3b's record job takes a `prepare` port. `wildshardPrepare` in
`src/cook/game/sidecarPrepare.ts` is the one a host passes: it runs the
author's own recorder, `wildshard prepare <folder>`, against this engine's
preparation client (`WILDSHARD_PREPARATION_CLIENT`), under the host's wrap
(on the box, SP1b5b: its own user, no network but the local page), with a
deadline. The child gets PATH, a scratch HOME beside the folder (removed
after), the client, and only the extras the host names (such as
`PLAYWRIGHT_BROWSERS_PATH`); never this process's environment. A failure or
an overrun rejects with the recorder's last line, so the record row says why.

`test/sidecar-prepare.test.ts` runs it with a stand-in recorder: what the
child sees (no secret from the parent's environment), a failing recorder and
one past its deadline.
