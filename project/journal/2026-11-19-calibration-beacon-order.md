# Check calibration steps independently of beacon arrival order

> Written by: Codex (codex-tc48)
>
> **State:** fixed 2026-11-19. EM9, CI run 44539259579, tests (6).

The staircase awaits each allocation and writes localStorage before
sending a beacon. It makes no order guarantee for delivery to the
receiver. Chromium delivered 8, 24, 16 and 32 MB to the test fixture.
The test compared arrival order with the page's allocation order.

Sort the received amounts before requiring exactly four readings.
A missing or duplicate amount still fails. The storage and reload
checks still require the last step to be 32 MB.

A scratch server that holds 16 MB until it records 24 MB reproduces
the hosted assertion on the original test. The revised test passes
the forced-order replay. The normal two-case suite passes in Chromium
and WebKit.
