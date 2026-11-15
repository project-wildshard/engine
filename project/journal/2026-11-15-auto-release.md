# AUTO-RELEASE (meta docs/plans/AUTO-RELEASE-PLAN.md, J355)

Jake, 2026-11-15 ~12:05 Cancún: ship patch versions with no Jake commands.

- npm needed nothing: 0.1.20 published from `npm-publish.yml` by OIDC at 16:05 UTC and npm listed it at 16:14 UTC.
  The "staged, needs 2FA" read was npm's processing delay; a rerun during processing gets E409.
- The cook was the one real gap: `cook.env` is root-only and holds the secrets. AR3: `rebuild.sh --cook` runs step 4
  alone, and the unit reads `/etc/wildshard/cook.settings` after `cook.env`, so the tag and build can move without the
  secrets. The restart hash is cook.env's own while no settings file exists, so the upgrade restarts once, for the unit.
- AR2 + AR4: `wildshard-apply <tag> verify` prints the commit a signed channel release names (after GitHub's tag check);
  `wildshard-config cook vX.Y.Z` takes the build only from that, writes `cook.settings` (640 root:wildshard-cook), runs
  `rebuild.sh --cook` and puts the old file back if the worker does not come up. It refuses while the box's
  `/opt/wildshard-vps/rebuild.sh` has no `--cook`. No sudoers change: `wildshard-config` is already allowed with any args.
- AR5: `scripts/release-cook.mjs vX.Y.Z` is the release's last step: it checks production serves the tag, installs the
  cook verb from a signed tag that carries it (only after `wildshard-harden --check` has no fail row), stops a dead-man
  harden armed from the new session, then runs `wildshard-config cook`. `--dry-run` today: no signed release carries
  the verb yet, so it waits for the next staging serial.
- Review fixes (one `claude -p`, 2 MUST): release-cook checks the unverified release file's tag and build shapes before
  they reach a box shell; `wildshard-config cook` ignores SIGHUP/SIGPIPE, runs the rebuild in its own session and rolls
  back on any exception, so a dropped ssh caller can't leave the cook down. SHOULDs: rebuild.sh takes one flock for every
  path, `--cook` refuses a tag that no longer peels to the verified build, the harden wait retries ssh 255, the dead-man
  stop is checked, `show cook` matching is exact, `Object.hasOwn` for the apply verb, the `--cook` probe looks for the flag.
