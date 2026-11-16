# Journal image alpha tint

> Written by: Codex
> **State:** built, 2026-11-16.

Carry an admitted currentColor tint through the actual journal resolver
and render that image as a CSS alpha mask. Found and unknown stickers
retain their inherited paint and opacity; normal full-color images keep
the existing image element. The URL crosses CSS only as a quoted value.

Six real product/DOM cases pass against the candidate format, including
the unmodified image path, quoted URLs, selector order and pick actions.
Full types, game lint and the CSS gate pass. Appearance remains Opus's
row; producer publication and old syntax removal remain open.
