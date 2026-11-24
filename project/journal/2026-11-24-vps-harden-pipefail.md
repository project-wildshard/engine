# harden.sh: no `grep -q` at a pipeline's end

> Written by: Claude (lane opus-fp21)

Main run 45359415900 went red on `test/vps-harden.test.ts`: the audited box's stub `ss` lists 127.0.0.1:11434, yet
harden.sh printed "ok VH2 nothing on 11434". No socket is involved; the script runs `set -o pipefail`, and in
`printf | grep -q` grep exits at its first match, the printf before it can die of SIGPIPE, and the pipeline fails. Every
such pipeline now ends in `matches` (grep reading all its input, output dropped), and a test refuses a new `| grep -q`.
The other VPS scripts with pipefail (harden-apply, harden-caddy, harden-prometheus, restore-check, setup, rebuild) have the
same shape and are left for a follow-up.

Follow-up, same day: harden-apply, harden-caddy, harden-prometheus, rebuild, restore-check and setup each define `matches`
and end their pipelines in it (21 pipelines), so their checks on the box stop reading present lines as absent; the guard in
`test/vps-harden.test.ts` now covers every `scripts/vps/*.sh`. Nothing ran on the box; the release carries it there.
