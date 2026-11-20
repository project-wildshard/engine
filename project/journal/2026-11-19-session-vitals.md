# Session vitals

METRICS MT11 adds the rendered first-frame time, time to world control,
device class, chosen GPU tier and foreground play FPS buckets to the
existing session summary. The loading card's clock includes the adopted
navigation shell. The first joined world keeps its times through later
zone entries. The heartbeat still reports once when the next page reads
it. Older heartbeat records migrate without fabricated readings.

The reload fixture proves the existing report carries the new values
and the original page's actor and lane.
