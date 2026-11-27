# Bound the APFS file-copy helper

An engine commit sat for 16 minutes in a Python APFS clone helper
waiting on stdin. Both APFS batches now share a 60-second limit. The
tracked-file copy hashes any files the helper already produced, then
Git writes anything missing. The build-state copy reports a timeout so
the gate can remove the incomplete copy.

The regression sends more than a pipe can hold to a helper that never
reads it and ignores SIGTERM. The helper stops at the test deadline.
