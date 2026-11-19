# Test and tool readers carry the skin rigs a room reads

a2374e817 gave the worker, the headless folder and the cook the spawned
skin rigs (serverSkinRigs), but some 30 tests, fixtures and one script build
a room's input from a built folder with their own copy of the bin/json/wasm
filter, so Template rev 10 (a spawned boar with a skin look) threw
'species boar: missing admitted skin GLB' in each. serverInputFiles is that
filter plus the rigs, and every copy now calls it (opus-bb9, AP36c).
