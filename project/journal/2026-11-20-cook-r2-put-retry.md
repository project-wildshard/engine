# Retry a transient R2 refusal before recooking

Staging admitted Pine Hollow upload `6cbb2284` on engine `0.1.54` before
API v0.26.1 deployed. The running cook finished its child in 903 seconds,
then R2 returned 503 for the phone entry object. Retrying the whole job
spent another 818 seconds in the child.

The channel-scoped pending feed still carries upload ID, slug, hash,
revision and format version. The cook takes its worker from the signed
staging release. The recorded author engine pin is absent from the feed.

Retry the same object after 250 ms and 1 s on HTTP 429 or 5xx. Keep the
existing final error, and fail a permanent response immediately. The
regression test reproduced the single-PUT 503 before the change and
checks that the retry sends exactly the same object bytes.
