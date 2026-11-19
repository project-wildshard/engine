# T1 on Brasscap

TEMPLATE-E2E TR-4 (opus-templates3). The T1 suites (A to D) seat
`brasscap-mesa` now that the Template is gone from Ring 1. Running them
found three real bugs, each fixed in its own commit:

- `fps` was not an environment flag, so T1's seat URL booted the
  default level behind the title and its first Play entered a lone page
  while Play after Exit to Title went through the grid: two saves, and
  the opened canyon gate came back shut.
- The STAGING mark sat on Brasscap's magazine (a tappable reload).
- The T1 online rig served no signed `code-retention.json` (a console
  404 on every page), and a reopened worker rig collided EEXIST with the
  last one's folder.

`inPlay` now treats a probe that throws because its level retired as
"not in play yet". Local: A+B 7/7, C+D 16/16.
