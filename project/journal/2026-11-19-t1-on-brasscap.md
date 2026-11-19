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

## TR-4 hosted (opus-templates4)

- Hosted T1 was red because J400 ran A-D on the products runner at once
  (four software-GL browsers, four cores): all four killed at 130 s. Each
  suite has its own runner again (t1-e2e matrix on the producer's tar).
- Journey is two suites (E: select cold/warm + swipe; F: MMO + deep link):
  its four boots were 45 s of C's 84 s locally. t1-batch.mjs deleted.
- STR31's layer spec failed on Brasscap's grid page: `.ws-grid-speed`
  composited a full-screen layer at opacity 0. Hidden at rest now.
- Planted fault `WS_T1_FAULT=loading-stall`: only the phone loading-bar
  spec goes red (verdict.stalls, 18 rows).

## TR-5 (opus-templates4)

- Pin readers move off the template pin to brasscap-mesa: cook refusals
  and hostile pins, packs-contract, worker bootstrap, hover-touch, and
  nine-ring1 (Brasscap + Nine, Brasscap road filler). The uncatalogued
  refusal names driftwood-isle (published, not in Ring 1's catalogue).
- online-rig-ephemeral was main red: the T1 rig's retention signing
  wanted a commit-named build; it now signs only for those.
