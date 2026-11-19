# Give Brasscap's independent boots their own runners

TR-4b's original fixture reliably stalled for 120 seconds on Mac SwiftShader after the worker had reached play. It kept drawing that world while opening a second browser context. Suite G now checks worker-page reuse, navigates that page away to release its renderer, and opens the independent world with the first page and context still open. Both original checks passed in 80.7 seconds of active suite time.

The real save reload stays in B. The Exit-to-Title test runs in H as the only browser world and passed in 84.6 seconds. The released-save journey runs in I and passed in 72.1 seconds. A keeps boot and probes and passed in 52.2 seconds. B’s real save reload passed in 66.3 seconds. D keeps the two-peer online rig. Both dev-world server cases passed in 86.6 seconds in J. The same 120-second budget applies to every suite. The receipt collector follows the suite map so a missing or failed new suite counts against hosted qualification.

Hosted run 44504623966 also found that the phone hover test exceeded its five-second wait for 20 drawn frames under software GL. The gesture uses a 300 ms monotonic window. The test now waits 350 ms after it sees the board mounted and verifies the same real dismount. The patched hover case passed in 2.4 seconds on SwiftShader. The initial local C run overlapped another browser proof and reported a separate 22.2-second weapon and assembly loading-bar stall. The progress assertion and its threshold stay in place.

The release and pack 503 tests observe their required screen before control and verify the proxy matched the fault. The release is read again at dial, so an early lookup alone cannot prove the screen. Both tests recovered in one worker, but that worker took 127.8 seconds. The isolated K and L runs passed in 100.6 and 43.0 seconds.

The C replay running by itself still measured a 5.4-second weapon and assembly loading-bar gap under the software renderer. The new hover case passed in 2.1 seconds and six other cases passed. The loading-bar failure remains visible in its receipt.

The two-peer suite timed out when the second page started beside the first live renderer. It also timed out when the first page was frozen. Starting both peers before either had settled into its render loop reached real control on both pages. All three body, chat and reconnection cases passed in 115.7 seconds on the same SwiftShader build.
