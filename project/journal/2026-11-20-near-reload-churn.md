# Near view reload churn (DF11, mini-df11e)

- A near view refused for room was refetched and re-decoded on every allocator revision: four of Driftwood's
  neighbours ~52 times each over the route, ~580 MB of promoted ArrayBuffer garbage and a third of WebKit's full
  collections. NearPlaceholders now keeps each view's size from its first load and asks `allocator.wouldFit` before
  reloading. Full GCs per route 23/22 to 15/15 on desktop WebKit at the iPhone 13 profile.
