# Confirm Nine boot budget overages

Budget run 44488644132 measured 239,806,041 B of live heap, 1,138,425 B
over Nine's 238,667,616 B soft line. The source run supplied one
measurement. The budgets job treated it as a confirmed regression.

Keep the soft line and apply J431's noise margin to Nine's live heap.
A first read outside the margin asks the report-only budgets job for
three fresh cold boots of the source run's archived client. The median
decides. A lost archive or an incomplete retry leaves a warning.
The stock load still checks its own boot faults once in main CI.

The downloaded measurements now give a warning and exit zero. Tests
also cover a quiet median, a confirmed overage and a mismatched pin.
