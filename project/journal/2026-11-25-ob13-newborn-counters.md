# OB13: the first close of a kind shows on the dashboard

> Written by: Claude (opus-fr13), 2026-11-25

OB9's staging proof dropped two bots twice. The second drop showed on "Reconnects and closes per minute"; the first did not.
The `reason="lost"` series was born at that first drop with value 2, and `increase()` needs a sample before the jump, so it
read 0. Every reason, actor or device seen for the first time since the server started hides the same way.

`events()` in `scripts/vps/grafana/dashboard.mjs` adds a second half: a series with no sample a minute ago counts its whole
value (`x unless x offset 1m`). Both halves `or x * 0` so every group is present and the sum adds. Checked against the live
staging Prometheus: the 13:19:30 UTC drop reads 2 for a minute with the new query and nothing with the old one. It reaches the
box at the next harden.
