# Memory gates block only where they are armed (J424)

Jake, 12:42 and 12:44 Cancún: "Whatever memory gates are in place, let's
not make them mandatory right now, all improvements are improvements",
then "the gates should only block once an agent has done the work to get
it under the gate" and "we shouldnt hurt dev velocity right now on the
gates".

So the hosted memory guards are report-only by default. A zone in
`scripts/memory/ledger-ratchet.json` or `webkit-ledger-ratchet.json`, or
the Template anchor in `footprint-ratchet.json`, blocks only when its
entry says `"armed": true`. The agent who gets a zone under its line
writes that flag. After that, the zone blocks only a regression back
over its line. Nothing is armed today, so neither memory job can turn
main red on a reading.

What an unarmed zone does now:

- It boots once, with no confirming second boot. A boot that never
  reaches control is printed and skipped.
- Its comparison still runs. When it is over the line, a
  `REPORT, not armed, blocks nothing (J424)` block carries the same
  bytes and the same line as before.
- When it is under the line, it joins the printed list of zones ready to
  arm.

An armed zone keeps the confirm-once guard from this morning: it fails
only when both readings are over the line.

Coverage changes are reports too. A new zone with no baseline is
reported, and so is a zone that was not measured, unless it is armed.
Those used to throw a coverage error for the whole job. Recording
(`memory_record`) is unchanged and still strict.

I did not count `wildshard/owned-buffer` as a memory gate. It is a lint
that asks for the ownedArray helper and never measures bytes, and it
stays as it was. If the Coordinator wants it softened too, it is one
line in `.oxlintrc.json`.
