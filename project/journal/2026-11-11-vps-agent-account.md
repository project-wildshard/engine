# The agents' box account (J266, MMO-SERVER MS3.5)

- Jake: "do the proper user account". harden.sh now owns what his one-off
  `agent-setup.sh` made: `wildshard-agent` (key only, root's copy of the
  key), `AllowUsers raynos wildshard-agent`, `sudoers.d/21-wildshard-agent`
  (raynos's fixed list plus the helpers and `/opt/wildshard-vps`), and it
  refreshes `/opt/wildshard-vps` from wherever it runs. raynos untouched.
- Two root helpers: `wildshard-config` (allowlisted non-secret keys into
  `<channel>.settings`, read after `.env`; rolls back if unhealthy) and
  `wildshard-apply <tag>` (only a tag a signed channel file names, checked
  as pull.mjs checks it). Bootstrap still needs one root run of this
  harden.sh; after that the agent updates itself through wildshard-apply.
- Folded in VH16's lynis floor at the coordinator's ask (443 gate needs 80).
- Codex J206 round 1 NO-GO, folded: the agent's key now lives only in root's
  `/etc/ssh/authorized_keys/wildshard-agent` (a Match, checked with `sshd -T -C`), the
  config rollback restarts even a dead unit, root reads of channel-owned files are bounded,
  and setup.sh had backticks inside unit heredocs that bash would have run as root.
- Round 2 NO-GO on the last MUST: wildshard-apply now reads nothing a channel user owns,
  only the bounded RELEASE_URL answers, so a tag must be one a channel serves today.
