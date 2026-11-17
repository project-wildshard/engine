# Nine hosted GPU timing is observational

Run 44040033228 on bb659a34 completed its street measurement after
our ten-minute timeout fix. Full log and artifact 14309234027 name
`ANGLE (Apple, ANGLE Metal Renderer: Apple Paravirtual device,
Unspecified Version)`. This is the hosted macos-15 virtual GPU, not
Jake's physical Metal MacBook used for NB6's timing baseline.

The walk measured 4.219 fps, frame p95 100 ms, GPU estimate p95
55.4 ms, control 75138.4 ms and first frame 9288.2 ms. Geometry
and route checks passed; no engine regression commit is established
by timing across these different devices. There was no missing
browser and no timeout this time.

Treat the explicitly named Paravirtual renderer like the existing
software renderers: retain and archive every measurement, but do not
compare its timing with physical hardware. Route completeness,
measurement duration, tier, submitted draws and triangles still gate.
All physical Metal timing limits stay unchanged. No baseline rewrite,
continue-on-error, or job-level waiver. Preserve the peer's workflow
critical-path edits in the shared checkout.

Validation: first replay test red with the observed timing failures;
then the same test green, with physical-Metal timing failures and
virtual-GPU draw/triangle/route failures still asserted. Replay of
the full downloaded artifact also passes only after classification.
J393 mode 1, per release-owner runner-mismatch instruction.
