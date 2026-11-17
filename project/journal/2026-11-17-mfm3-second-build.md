# 2026-11-17 opus-mfm3: the second-build rig (meta MMO-FAILURE-MODES-PLAN)

- `online-rig.mjs` gains `pageView`, `retain` and `move`: two builds from one signed release flow, so a proof can retire build A
  (FM5b4), deploy under a title tap (FM4 10b) or under play (mode 10). The page view lives at `/__release.json`, the plan's
  second signed view; the world only reads `/release.json`. `signRetention` is shared with the page publisher's signer.
- The preview server's SPA fallback answered a missing `/code-retention.json` with the page (200); production's asset host
  answers 404, which the page reads as a legacy page. Now the preview server does too.
- `reloadPastWorker` (too-old's Update, the new-build panel, Play here) never raised the RELOADING cover, so a player's tap left
  the old page standing for up to the worker drop's 3 s. It now puts the cover up first (R3/RL3), as the stale-build reload does.
- FM7b2 (mode 25): the door keeps a waiting line (`seatQueue.ts`): ordered tickets per seat, a freed seat held for the head,
  the position (and an estimate only from the line's measured turnover) in FM7b1's `queue` close facts. No new wire: the page
  retries on its 30 s cadence (each retry renews the ticket, 50 s life) and Title says the clean quit it already says on Leave
  (`ready` + LEAVE_FLAG on a fresh link), which the door now reads as cancelling the ticket. That was the "cancellation
  transport" the row waited on: the client-to-server word already existed.
- FM4 queue numbers: redial keeps the door's last facts (never counted down), the full card says "Place N in line", the
  estimate or "estimating the wait", and has a Title screen button that leaves the line.
- The first real deploy on the rig found three gaps. A rig `move` stopped the page host before it started the next one, so
  every tab the world sent home met 502s; a rig with a second build now fronts its page port and swaps hosts with no downtime,
  the new host up before the release names the build, as a real deploy orders it. The second build carried none of the first
  one's files, so a tab still on A asked B's host for its own chunks and got the SPA page (`admission.modules`, "Unexpected
  token '<'"); the proof's `--prepare --next` now runs the release's carry step (MF2). And a retired build's quick reconnect
  (under the banner's 2 s) never reached `tooOld.refuse('reconnect')`, which only ran once the banner showed: redial now asks
  `mayDial` before every dial, and the shell's answer is the too-old check, so the refusal comes before any dial.
