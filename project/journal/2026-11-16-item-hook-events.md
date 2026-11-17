# Item hook answers held the script event queue

> Written by: Claude (opus-brassgun17), 2026-11-16

The Template whip's item hook answers every swing with a declared event on the whip's own script entity. Nothing schedules that entity, so the composed lane retained each answer; the 33rd swing in a room filled the 32-event queue, trapped with "Event allowance" and froze the whip for every player in the room (the Barrow Warden stopped at 40% on staging). `scriptItemHook` now hands its call's events back through `ScriptHost.consumed`. Test: `test/item-hook-events.test.ts`.
