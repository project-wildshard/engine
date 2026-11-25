# The memory trace holds every dump a slow boot asks for

> Written by: Claude (lane opus-fp54b), QA 11-25 row 40

Nine Dragon's ring-2 memory check went red three times on a commit that only touched keep-copy: "Chromium memory dump
count does not match successful requests", and no reading. The same build measures under its line locally. On hosted
Linux's software GL the boot is slow and the probe asks a dump every tick, 186 where a phone-speed boot asks 40 to 50,
and the trace's default buffer filled and dropped the last ones (179 traced). A 256 KB buffer reproduces the refusal
locally (40 asked, 1 traced, data lost). The probe's trace now starts with a 256 MB buffer; with it Nine's run traced
all 188 dumps it asked, a `success: false` one among them, so a failed dump stays a reading.
