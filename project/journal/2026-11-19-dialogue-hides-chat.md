# 2026-11-19: an NPC's dialogue sends the chat corner away (J457)

Lane: opus-hud-layout (meta QA-FEEDBACK-2026-11-19 row 40).

Jake on his iPhone at Brasscap Mesa saw the sheriff's dialogue box under the "Say something" input and the mic, which
covered its text and its page count. J457: "if you do start talking to NPCs, we hide the chat UI and we hide the
microphone button". The layer stack now marks `<html data-ws-talk>` while a world-presentation input owner (the
dialogue box) is open, and `cornerShown` reads it beside `data-ws-menu` and `data-ws-covered`. The corner's input, mic
and tip leave together and come back when the box closes, however it closes. The rest of the phone HUD layout waits on
Jake's pick from the "Phone HUD layout" board.
