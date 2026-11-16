# Align the room proofs with native continuation

> Written by: Codex
> State: mode-1 main-red repair, 2026-11-16.

Main run 43969009665 exposed two old fixture assumptions after af0adf3f4.
Both failures reproduce before the changes here.

The armed-room digest includes adapter snapshots. The native slot view now
intentionally saves its clock, memory and globals after every first frame,
including living and empty cycles. Rebaseline only that room-state digest
to cd2d9048; the unarmed digest and all movement, tier and arrow assertions
remain unchanged. This accepts the intended continuation data, not a new
wire layout or a performance-budget change.

The night-save fixture installed chapters after strict native restoration.
Chapters now own a continuation adapter, so that ordering cannot reproduce
the saved registrations. Prepare the real chapter installer first and run
it through the resident's installation callback, before restore validates
the registrations, as the normal room composition does. Keep the strict
snapshot guard and every awake-body, standing-site and collider assertion.

No escape hatch. The unrelated identity and view-lane edits in this shared
checkout belong to their owners and are excluded from this commit.
