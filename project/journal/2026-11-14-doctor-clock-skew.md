# Doctor clock-skew warning (buddy-engine)

- MMO-FAILURE-MODES FM4b mode 42 (`clock-skew`). The Doctor already
  measured the device clock against the server's health `now` (or the
  page's `Date` header) and warned past 30 s, but only when the socket
  gave pongs to time: a blocked socket turned a 2-minute-off clock into
  a quiet `skip`.
- Now the warning stands on its own: past 30 s the latency row warns
  with the measured offset, says behind or ahead of the server (or the
  page's host), and the fix (automatic date and time, then Run again).
  It never says the clock caused a failed secure connection. The row
  carries `data-failmode="clock-skew"` in the Doctor view, as the
  link's cards carry theirs. Recheck and Back are the Doctor's own
  Run again and Back.
- Negative controls in `test/doctor-clock.test.ts`: clock unknown and
  29 s off pass; unknown with no socket still skips.
