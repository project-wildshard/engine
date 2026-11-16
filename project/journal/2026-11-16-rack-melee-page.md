# A racked sword starts locked on the page

TEMPLATE-E2E TC-E4b (opus-brassgun9). TC-E4 racked Mossgate's iron sword on the server, which refused its blows until the
rack's take, but the page's kit unlocked every melee row at install: a WebKit probe on engine `fafee64e` pressed slot 2 at
spawn and drew the sword. `installDeclaredItems` now takes `racked` (`rackMeleeRows`) and locks those rows as it locks a
lever. The grid kit already unlocked a racked weapon on its taken line. The one-shard page now does too, and off the wire its
rack's scene unlocks it. The probe after: slot 2 at spawn keeps the whip, and the rack's take brings the sword to hand.
Test: `test/declared-rack-melee-page.test.ts`. Still open: the rack's "Take the iron sword" prompt stays after the take.
