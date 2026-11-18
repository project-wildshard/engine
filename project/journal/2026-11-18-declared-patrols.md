# 2026-11-18: a patrol walks its route (ONE-FORMAT OF37b)

opus-pin. Format 0.40.0 carries OF37a's `creatures.patrols`. `installDeclaredPatrols` drives each row's members as one
line: each keeps its spawn offset from the line's middle about the stop it walks to, and the line takes the next stop
when its middle reaches this one, round the closed route. A living player within `engage` of any living member turns the
line into a fight (each member runs at its nearest living player and strikes in reach). Once every living member is more
than `leash` from the route (the closed route, so the last leg back to the first stop counts), it walks back to where it
left the route, deaf to players, and walks on. Mode, next stop and the leaving point are one adapter per patrol, so a
save keeps them and shards without patrols install nothing. Nalati's `encounter.patrol` stays on its own law until OF24.
