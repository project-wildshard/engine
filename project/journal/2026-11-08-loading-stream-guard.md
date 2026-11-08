# Preserve boot ordering and the WebKit stream-reader rule

The first full LS1 publication gate stopped all upload. Eleven cases
failed: ten extracted entry continuations lacked the newly referenced
timing helpers or searched for an unwrapped import, and the existing
stream guard caught a reader release in the new server byte collector.

The entry fixture now supplies the real timing functions and selects
the instrumented import boundary. It keeps every ordering and refusal
assertion. The new server reader runs to completion and is dropped,
without releaseLock, preserving the documented WebKit deadlock rule.
No timeout or safety assertion is removed. Both files pass all eleven
cases in 192 milliseconds. The real boot proof and full gate follow.
