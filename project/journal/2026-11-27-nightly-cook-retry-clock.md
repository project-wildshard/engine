# Let the nightly worker finish its cook retry

On WebKit nightly `46000160457`, Pine's first cold cook hit the
1500-second attempt limit and kept 249 encodes. The worker logged its
first retry. The enclosing head process had a 1530-second timeout and
killed it before it could finish.

QA54 gives the Ring 2 worker ownership of the attempt clock and waits
for its result. The 75-minute hosted job and browser lease still bound
the entire run. The guard verifies the production clock reaches the real
child invocation, the parent waits, and the hosted budget fits a retry.
