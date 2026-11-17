# MMO-PLAN MP1.6: the crossing churn (opus-mmo1)

- The churn (bots crossing Driftwood ↔ Sunscar on one worker and Driftwood ↔ Nalati across workers, a coin paid per visit) stalled
  after ~400 crossings: an entry into Sunscar was refused with "Invalid native melee JSON continuation". A native melee plugin with a
  stepped hold saves the lead seat as a JSON string and every other seat as `{melee, hold}`; the lead is whoever arrived first, so a
  save made as the second player failed to import into an empty Sunscar (and the lead's beside someone). The import now reads either shape.
- The 10,000 then stopped three times at ~7,600 crossings with every walker standing still in Nalati, alive, input empty. A client's
  command `seq` is a u16 that runs on across a crossing; a cell on another worker hears the link with a fresh queue whose `lastSeq` is 0.
  Past 0x8000 (about nine minutes at 60 Hz) that 0 read as ahead of every command the client held, `flush` trimmed them all as acked and
  sent nothing again. An ack now counts only when it moves on from the last one and doesn't pass the client's own `seq`. The predictor
  reads that 0 the same way (it stops reconciling); the root fix carries the queue's `lastSeq` in the hand-out (MMO-PLAN MP1.6b).
