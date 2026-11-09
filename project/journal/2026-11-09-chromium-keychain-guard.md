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
