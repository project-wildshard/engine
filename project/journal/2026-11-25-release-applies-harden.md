# A release applies its own harden (opus-rel86, FAST-RELEASE FR-A11)

- Four times a lane ran `wildshard-apply <tag> harden` by hand after a staging release changed scripts/vps, waiting 0 to 8 h for a lane (FR-A9); OB9's Grafana waited on the next one.
- release-cook.mjs, which page-release already runs for staging and the train's end for production, now compares scripts/vps between the box's last harden and the build. wildshard-apply stamps `/var/lib/wildshard-harden-applied` with the commit after a harden exits 0; until the first stamp, the cook's previous build stands in.
- Due means the same --check gate as the cook verb's install. A gate or apply that fails is a `warn` line naming why, never a stopped release.
- The train also checks ASSISTED_BY before its local QA: v0.1.86's first run spent 5 min of QA, then prepare stopped on it and its log went with the scratch. The prepare log now stays with the evidence.
