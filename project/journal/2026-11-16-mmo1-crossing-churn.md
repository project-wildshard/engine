# MMO-PLAN MP1.6: the crossing churn (opus-mmo1)

- The churn (bots crossing Driftwood ↔ Sunscar on one worker and Driftwood ↔ Nalati across workers, a coin paid per visit) stalled
  after ~400 crossings: an entry into Sunscar was refused with "Invalid native melee JSON continuation". A native melee plugin with a
  stepped hold saves the lead seat as a JSON string and every other seat as `{melee, hold}`; the lead is whoever arrived first, so a
  save made as the second player failed to import into an empty Sunscar (and the lead's beside someone). The import now reads either shape.
