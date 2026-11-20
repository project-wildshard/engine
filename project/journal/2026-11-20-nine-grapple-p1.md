# Nine's grapple on a client-plan page (P1 OF21)

> Written by: Claude (opus-of21-drift5), 2026-11-20

v0.1.57 shipped Nine r6 with no Fei Zhua. The OF41c page claw was gated on `!nativeFeatures`, and Nine r6 is a
client-plan page (portal ride, practice course) whose plan no longer has a held play entry, so nothing built the claw:
the staging walk found jian and hoverboard only. The page now draws the declared claw on any page unless a
`held.claims.enter` entry carries one (`declaredGrapplePageOwns`).
