# AUTO-RELEASE (meta docs/plans/AUTO-RELEASE-PLAN.md, J355)

Jake, 2026-11-15 ~12:05 Cancún: ship patch versions with no Jake commands.

- npm needed nothing: 0.1.20 published from `npm-publish.yml` by OIDC at 16:05 UTC and npm listed it at 16:14 UTC.
  The "staged, needs 2FA" read was npm's processing delay; a rerun during processing gets E409.
- The cook was the one real gap: `cook.env` is root-only and holds the secrets. AR3: `rebuild.sh --cook` runs step 4
  alone, and the unit reads `/etc/wildshard/cook.settings` after `cook.env`, so the tag and build can move without the
  secrets. The restart hash is cook.env's own while no settings file exists, so the upgrade restarts once, for the unit.
