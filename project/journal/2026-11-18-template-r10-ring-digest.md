# Template r10's ring digest is re-recorded

Main run 44437207022 failed tests (9): Template's 240-tick server
replay read 0f450daf2c1f1f53 against the recorded cbe1f6c87f319620.
The other seven ring rows matched. 6b1ab2ab pinned Template rev 10
(cc1fcd31): a chest that sets its flag, the boar's skin rig, and a
blob that backs off between strikes.

It is r10's content, and it is deterministic:

- r10 stepped twice on darwin-arm64 gives 0f450daf2c1f1f53 both times,
  the digest CI read on linux-x64;
- r9's pin rows on the same engine code give cbe1f6c87f319620 again;
- the chain differs from its first link (tick 60), as new content does.

Template's chain is recorded anew for darwin-arm64 (`ring-step.ts
--update --only template`) and copied to linux-x64, whose chain has
always matched darwin's. A full ring step then reads all eight rows
the same.
