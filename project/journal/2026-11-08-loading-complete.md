# LS1: prove coverage through loader completion

The manual gap check previously waited for loader completion but only
checked coverage through the first setup game step. It now uses the
actual app:loader-complete stamp as its endpoint. Unresolved intervals
closed mechanically at that boundary cannot count as coverage. The
first-step and loader-complete times are reported separately.

On real Sunscar boots with the server's optional page-byte loan withheld,
Chromium reached first-step/loader-complete at 1313/8307 ms and WebKit at
2181/3301 ms. Both had zero unnamed gap through the full boot. A genuine
five-second wait injected inside the measured server-world callback gave
WebKit 2035/8477 ms and a 280 ms maximum unnamed gap. Streamed worker
bytes, named server construction and actual rendering were retained.

A 30-second injection also produced a successful Chromium boot at
1457/37855 ms with a 275 ms gap. Its WebKit counterpart recorded an actual
server:world-boot:failure instead of a booted-send. That run is red and
is not claimed as a successful boot or a collector delivery failure.
The proof now prints recorded failure details when a required stamp is
absent. No runtime delivery change was retained without a reproduction.

The manual loader bound is 120 seconds to cover measured late work; no
application timeout, UI, CSS, hook or unit-test entry changes here. These
are additive commits above 2929143; its loading collector content stays.
