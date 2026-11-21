# FS30: Nightly cook uses the worker's limit

Nightly run 44770621187 passed the production worker's 1,500-second
allowance to Ring 2. The CLI still imposed its old 600-second ceiling and
refused the request before starting any cook. Both now read the same
worker default. Ring 1 still defaults to a 120-second cook.

The regression invokes the actual CLI with Ring 2 arguments. It reaches
output validation at the worker limit and refuses a millisecond more.
The nightly plan and tag tests and the 11 nightly receipt proofs pass.
