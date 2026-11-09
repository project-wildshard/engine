# Every Chromium launch carries both keychain flags

Reviewed published e5ac68c at origin c7738d7. All four raw launches
carry the shared flags; phone-loading source stays untouched. The old
file-level check missed loading-card-proof persistent GRID contexts.
That real launch now spreads KEYCHAIN_ARGS too.

The shared dependency-free guard checks each Playwright start and every
raw child-process API, including aliases, namespace/bracket calls,
literal binary paths and shell executable variables. One safe launch
cannot hide another bare one in the same file. Typed injected author
hosts and regular-expression exec calls are not process launches.

Parity pool connections inspect the actual connected Chromium command
line before use. Other CDP connections own an explicitly safe raw or
launchServer process in the same file. Playwright defaults stay enabled.

The focused guard passes three cases in 1.48 seconds. Renderer and
admission stamps use immutable Git view 5341e21. Peer working-tree
generated outputs stay untouched. This review opens no browser.

The first full push refused eight lint errors in the new guard and pool
check. The forward correction uses replaceAll, preserves its input
parameter and avoids shadowing. No lint rule or existing test changes.

The actual lane-pool proof found command-line inspection unavailable
without --enable-automation on launchServer. Add it explicitly to that
headless proof launcher so the connected process can be checked. The
two mandatory keychain flags remain explicit. Phone-loading stays alone.

The subsequent real Chromium lane-pool proof passes: CDP reports both
mandatory flags, and pool.close drains the browser and lane subprocess.

The focused guard passes three cases in 1.48 seconds. Renderer and
admission stamps use immutable Git view 7eb4909. Peer working-tree
generated outputs stay untouched. This review opens no browser.

The focused guard passes three cases. Renderer and admission stamps
use immutable Git view d61a179. Peer working-tree generated outputs
stay untouched. Computing this source inventory opens no browser.

The focused guard passes three cases. Renderer and admission stamps
use immutable Git view df4b415. Peer working-tree generated outputs
stay untouched. Computing this source inventory opens no browser.

The focused guard passes three cases. Renderer and admission stamps
use immutable Git view 01daf4b. Peer working-tree generated outputs
stay untouched. Computing this source inventory opens no browser.
