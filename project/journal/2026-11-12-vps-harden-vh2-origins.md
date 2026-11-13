# 2026-11-12: VH2 token search, ALLOWED_ORIGINS helper key (MS3.4)

- Jake's `harden.sh --check` on the box failed VH2 with 4 files holding
  `sk_claw`. All four were copies of harden.sh itself (the search pattern
  is in the script). The check now matches a token's shape
  (`sk_claw_` + 16 or more token characters), skips harden.sh copies and
  the test plants by name, and prints file names, never contents.
- VH10: the box's unit still lists the retired Vercel page host (it came
  from a setup.sh before 9fbc7e53). `wildshard-config` gains
  `ALLOWED_ORIGINS`, narrowing only: a set of the three wildshard.io
  hosts that keeps the channel's own, so an agent can drop a page per
  channel without a setup rerun. The VH10 check reads the settings file
  last, as the unit does.
