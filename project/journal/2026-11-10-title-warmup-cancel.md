# Catch a cancelled title shader warm-up

The v0.1.6 phone check reached the Name form after a real title tap.
Chromium reported no errors. WebKit cancelled the title's optional shader
chunk while leaving the document and raised an unhandled native TypeError.
Staging reproduced it on the same build. The deployed stack resolves to
the dynamic import of `earlyPrograms` in `showPageTitle`.

Own the optional import until it settles. A WebKit module cancellation
or AbortError during departure ends the warm-up. A live import failure
and an unrelated exception still reach the browser's error pipeline.
The title still starts the same warm-up, with no boot wait or rendering
change. Tests cover rejection during departure, reportable errors, and
the live/departed success paths.

J206 caught a restored document still marked as departing. `pageshow`
rearms its pending read. The same regression verifies that all temporary
listeners are removed on either settlement.
