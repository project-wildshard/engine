# The box hardens a lean tag through a bridge

> Written by: Claude (opus-rel86)

> State: done 2026-11-26. The box hardened from v0.1.96's lean tag (stamp 48084eb2) and the bridge is removed.

v0.1.95's staging cook move rolled back at 09:08 UTC (meta QA 11-25 row 88). The box's
root-owned copies predate the lean move:

- `/opt/wildshard-vps/rebuild.sh` ran `scripts/assert-store-layout.mjs` in the cook checkout,
  which a lean tag keeps in `src/scripts/.kit/`, so the cook worker never came up.
- Only harden refreshes that copy. release-cook skipped it because `harden --check` failed
  VH5 (a new kernel installed, reboot pending), and VH5 counted as a row that could touch ssh.
- Run by hand, the box's `wildshard-apply <tag> harden` stopped: it unpacks `scripts/vps` from
  the signed commit, and a lean commit has only `src/scripts/vps`. No lean tag could ever
  refresh the box, so every release from here on would roll back the same way.

The fix:

- `scripts/vps/harden.sh` is a bridge. The old apply unpacks it and runs it from the commit's
  folder beside its bare `engine.git`; it unpacks `src/scripts/vps` from the same verified
  commit and runs that `harden.sh`, which installs the lean `wildshard-apply` and refreshes
  `/opt/wildshard-vps`. It refuses to run anywhere but such a folder.
- VH5 joins SC2 in release-cook's `OFF_SSH_ROWS`: a pending reboot no longer holds the harden.
  `hardenGateOf` is the gate on a `--check` output, tested.
- `test/vps-lean-bridge.test.ts` runs the bridge the way the old apply does, holds it as the
  only tracked file under `scripts/`, holds the lean apply's unpack path, and holds every repo
  path a box script names to the tree (none pre-lean).

The cost: while `scripts/vps/harden.sh` is tracked, the kit's script-paths moved check no longer
treats this repo as lean for `scripts/`. repo-kit's guard should exempt the named bridge; once
the box stamp is lean the bridge goes and the check is whole again.

v0.1.96's staging cook move ran the bridge: release-cook applied harden from
`server-staging-48084eb2…` (VH5 no longer holds it), the cook came up on the lean tag
with its unit as rebuild.sh writes, and `/var/lib/wildshard-harden-applied` names
48084eb2. Staging and production share the box, so `scripts/vps/harden.sh` is
deleted and the test now holds `scripts/` empty; the path and apply guards stay.
