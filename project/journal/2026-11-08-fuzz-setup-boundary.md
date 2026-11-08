# Keep the cold crossing bake out of room setup

Written by: Codex. 2026-11-08. EG-27, J186.

Public Linux runs 42446355727 and 42449016560 both stopped net-fuzz in
its ten-second beforeAll hook. The second local full publication gate
reproduced it: 5764 cases passed, but this hook prevented thirteen older
cases from running. All new quick cases passed in that complete gate.

Only the seam-crossing case consumes baked grid collision. Load it there,
not before every ordinary room case. The crossing already belongs to
Ring 2; its cold pinned-road bake and actual 900-tick transport crossing
exceed ten seconds, so give that one case a bounded sixty-second clock.
Do not increase a global hook deadline, add a mock bake, remove an
assertion, or route around the normal complete publication gate.

Repeat the existing real fuzz file, static checks and full pre-push.
The separate old Titan Linux timing failure remains explicitly recorded;
this change does not edit that shared repair proof or claim it repaired.
