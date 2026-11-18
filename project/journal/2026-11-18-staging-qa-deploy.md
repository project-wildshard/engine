# Staging deploy QA

The train used a new driver for every release and ran duplicate journeys, card
sweeps and live proofs after each staging flip. Jake asked for only the stable
deploy checks and roughly twenty minutes across the local and candidate legs
(J426–J428).

SQ1 runs K1–K5 and two journeys from one checked-in command. The Chromium journey
walks across a gate. WebKit enters the MMO from the title with touch controls.
The build has to match at the start and at readback. A deploy verdict checks
entry, an error card, movement and world draw. Vision findings stay in the
report. The older content and presentation probes keep their separate callers.

The first scoped checks on the v0.1.42 rollback reached play in K3, crossed a
gate on Chromium and entered the MMO on WebKit. The v0.1.44 run uses saved
v0.1.42 profiles for the two warm-cache legs.

SQ2 uses SB48's world-region detector for every deploy smoke leg and
journey. A transient dark frame can clear on the next sample. Three
consecutive black or empty frames hold the train. The MacBook K3 probe
on staging v0.1.42 and the dark and lit fixture checks passed.

The npm `next` workflow accepts the pre-alias K1–K6 verdict with black-world
evidence and two exact-build browser journeys. That lets QA 29 pin the staged
engine after the stable J428 deploy checks. Admission still verifies the green
release CI, live page and signed rooms release. The optional skipped ledger
diagnostic no longer makes an otherwise green release CI look red.
