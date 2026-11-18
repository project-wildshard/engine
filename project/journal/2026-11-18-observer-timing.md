# Schedule native release-observer cases independently

Hosted CI charged the combined observer suite 60.457 seconds against its 60-second file budget. Several checks deliberately wait for a deadline while real native clients move, reconnect or remain connected.

The input and cleanup cases now run separately from the continuity cases, using the same fixture for signed responses, native rooms and durable saves. All 13 original cases keep their deadlines and assertions. The local wall time went from 32.18 seconds for one file to 16.37 seconds for the two files, and the hosted planner discovered them on different logical shards.
