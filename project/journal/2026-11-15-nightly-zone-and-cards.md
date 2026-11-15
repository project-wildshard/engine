> Written by: Codex
> State: built on plan/tc-pins, 2026-11-15.

Real Chromium receipts reached gameplay after the boot fix, exposing an
obsolete 30 m/s hover expectation. These are standalone zone boots, so
assert the agreed 14 m/s zone cruise (J352) while retaining real mount,
unmount and draw checks. Do not make a deleted pin mandatory by name.

Template's discovery still names its authored `_template` folder, while
the cook publishes blobs and the header under canonical `template`.
Stored title rows now use that canonical resource identity and retain
the authored route and discovery URL. Both alias forms pass the HTML
regression; a real bounded Template cook verified all five emitted URLs
against its published keys. Far Reach's native capture timeout is separate.

The standalone hover-contract workflow calls the same runner; update its
matrix expectations to the same 14 m/s contract.
