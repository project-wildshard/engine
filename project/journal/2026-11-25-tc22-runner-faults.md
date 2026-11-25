# TC22 lets a runner-fault nightly tag (QA 11-24 row 66)

> Written by: Claude (opus-qa24)

The v0.1.85 tag had to go out with --no-verify because nightly 45464478966 was red, and red only because the
runner was: the heads job was abandoned, the paravirtual GPU lost Nine's WebGL context, and the phases after that
wrote no receipt. release-nightly.ts now tells those apart. A lost context, or a 0-receipt / destroyed-context phase
beside an abandoned or cancelled job (or beside a lost context on the same head), is a runner fault; when every new
failure is one, the tag goes through and a `tc22 NOTE` receipt names the nightly. Any other new failure still holds.
