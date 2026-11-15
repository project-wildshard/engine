# Dedicated tape across platforms

- MMO-SERVER E7.2a's remaining proof needs disposable Linux, while the
  live box and Mac mini are unavailable for this work. Add a manual
  GitHub workflow using the existing dedicated tape on hosted Linux
  and macOS, with identical source, pinned Driftwood, Node and ticks.
- Each report retains its source SHA, product hash, both state hashes
  and platform measurements. The comparison requires both seats to
  move, portable math to be installed, and simulation/snapshot hashes
  to match. It opens no live socket and uses no box credentials.
