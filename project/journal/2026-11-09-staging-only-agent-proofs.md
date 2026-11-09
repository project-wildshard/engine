# Keep live agent players out of human production

Jake settled J205: staging only for agents, production humans only.
The E7 VPS already has separate channel files, ports and default save
databases. Document the staging socket, separate client origin and exact
signed staging build at both the setup and release boundaries. No proof
needs a blanket production save wipe or another sudo command.

Codex-port owns the staging-stamped page and hard channel/socket/origin
assertion in its live proof. Codex-j189 owns the VPS/runbook wording.
This commit changes documentation only. It deploys nothing, runs no
agent against production and changes no unit, database or credential.
