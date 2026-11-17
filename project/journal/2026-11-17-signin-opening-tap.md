# Keep the sign-in card open after a phone tap

> Written by: Codex
> State: locally proved for36, 2026-11-17.

A real phone-UA v35 profile opened SIGN IN on pointerup, then the
retargeted mobile click hit its new backdrop and closed it. Desktop
mouse/keyboard sign-in worked, which is why the earlier proof missed it.

Use the existing followsTap guard in capture on the new card, before a
retargeted click reaches either its backdrop or a new button. A new
outside press still closes the card. The regression is red first on the
old handler and green with the fix; all17 card/title controls, lint and
types pass. Re-prove real mobile touch on36 staging. The35 baseline can
use the real keyboard action to receive its ordinary mailed link.
