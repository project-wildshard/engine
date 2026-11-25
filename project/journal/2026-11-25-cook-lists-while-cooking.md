# The cook lists the bucket while it cooks (opus-rel86, FAST-RELEASE FR-A2)

- v0.1.85's recook: Pine published 5.2 min after its 820 s cook, Dunes 13.5 min after a 6 s one; FR-A2's target is 3. The worker re-lists the whole bucket (minutes at staging's size) once its copy is 20 min old, and did it after the cook.
- Now a job starts that listing when the copy is past half its age, so it runs during the cook; a publish shares the one in flight, and a reclaim's recount still waits for a listing that started after it.
- Each publish logs `listing N s, M PUT(s) of K in S s`, so the next slow one says which part it was (Dunes may be CF-8's re-PUT of parts older than half the GC grace).
