# Request durable failed-profile retention

The queue now consumes the reviewed native-retain/1 protocol at 97a8632.
Callers previously printed a path, but normal terminal snapshot cleanup
removed that directory. Printing a path is not retention authority.

Native Escape and the detached-writer caller now write one exclusive UUID
request only when their failed cleanup deliberately leaves a profile.
The request contains the exact schema/kind/relative-prefix fields, stays
under 4 KiB, and is a private regular file. Validate owned directories and
refuse symlinks before writing. This requests the queue's separately capped
export; it never copies, deletes, retries cleanup or changes a verdict.
If the write fails, log bounded facts and preserve the original error.
No drain helper, startup deadline, cap or process ownership changes here.

The manual actual-caller proof first runs the real trusted Escape pair:
successful cleanup makes no request. It then creates an owned unreadable
profile entry through the native executable path. Real cleanup refuses
EACCES, retains the remaining bytes and emits the exact exclusive request.
Filesystem removal can already have removed other entries: this is not a
claim of atomic rollback or a full pre-failure profile. A second refusal
with an unwritable request directory logs that failure and still throws
the original profile EACCES, with no extra request. All fixtures are owned
and isolated. --request-only leaves the actual failed profile/request and
the original exit 1 for the queue owner's end-to-end export control.
That control may name a committed --caller-root while keeping the request
under the actual checked hook's cwd; it never grants a passing verdict.

The one-shot review's MUST gates writer requests on a rejected cleanup,
not just a not-yet-completed one: readiness and pre-cleanup assertions do
not request export. Its SHOULD removes pathname races: an inherited cwd
descriptor and isolated Python standard-library openat operations pin
each directory with O_NOFOLLOW through exclusive request creation. Node
has no openat API on Darwin. A replaced request-directory symlink also
refuses without writing any file into its target and preserves the
original profile error. Request writing has a bounded two-second helper
failure path; it never grants more cleanup or startup time to a passing
case, and failure still propagates the exact original error.

The manual proof is outside hooks. CI25 stays open until actual caller
export and hosted source proofs close the queue owner's remaining row.
