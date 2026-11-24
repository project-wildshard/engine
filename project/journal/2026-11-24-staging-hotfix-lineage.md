# Keep the v0.1.79 staging source in main history

Staging rooms/145 is the v0.1.79 reclaim and road-open hotfix. Its parent
has the exact two changes shipped to staging. Main already has both
changes, so integrating that parent keeps the current code, version and
release notes while giving newer staging cuts the signed forward ancestry
they need. The release's failure on retained production heads keeps its
production tag held.
