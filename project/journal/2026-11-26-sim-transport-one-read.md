# The transport client's started line no longer swallows the rest (opus-port130, main red run 45806252141)

- 8ccde047c's `run_transport_client` read the `started` record with a buffered `readline`, then `communicate`, which
  reads the raw fd. When both records reached the pipe together (Linux CI), `readline` took `complete` into its buffer
  and `communicate` never saw it: `['started'] != ['started', 'complete']`.
- The pipe is unbuffered now (`bufsize=0`), so `readline` reads byte by byte up to the newline. No retry, no timeout
  change. A new case writes both records in one write, which failed every time on the old reader.
