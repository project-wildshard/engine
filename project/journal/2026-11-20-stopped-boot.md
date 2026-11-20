# Interrupted world loads

METRICS MT12 records the active primary world boot and its stage in the
existing heartbeat. Receipt of the download promise advances the phase.
A reload can recover a stopped download, even without a pagehide event.
An explicit Exit to Title clears the pending attempt. An inset cell
load leaves the page's first world reading alone.
