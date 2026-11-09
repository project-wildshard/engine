# Failed worker startup reaches the loading card

LS4's actual failed-boot path is red on production d91507e-mw810im4.
Refusing the real standalone server worker script with HTTP 503 leaves
server:await-booted pending. The 61 s watchdog shows its existing error
modal, but the card remains on Server world with Hold and no Copy button
at 90 s. No synthetic event or ready signal was emitted.

The standalone shell awaited only control-port boot/failure messages. A
worker whose own script cannot load cannot send either. Race that existing
boot promise with its native error event, leaving the error observable.
The worker-client wrapper also swallowed startup rejection; propagate it
to the existing finish-stage plan failure so the existing diagnostics
control appears. No layout, backend, deadline or save-epoch change.

The manual worker-bootstrap proof now uses the actual emitted page shell
and real Worker. Its added HTTP503 case fails on old code (booted remains
pending at 750 ms), then passes in Chromium and WebKit. Existing real
heavy-runtime refusal checks still pass. This script remains outside hooks
and unit discovery. The real failed-page proof on the isolated v0.1.3 plus these wiring
hunks now reaches Copy immediately instead of hanging. It remains red
on reachability: the existing ws-load-error fatal screen intercepts the
actual tap. No forced click or hidden overlay was used. The full native
clipboard and whole LS4 row remain open; the error-screen consumer needs
to expose the existing diagnostics without covering them. No layout
change is included here.
