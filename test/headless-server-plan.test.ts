// QA-FEEDBACK-2026-11-23-b row 41 (J505 guard): HS6e left the server reading its plan only from `server/plan`, but format's
// headless section list names `client/plan` only, so every headless check (`wildshard check`, the bake, the cook's proof)
// dropped the plan and Nine's portal director refused the simulation (Ring 3 run 45335242015). A headless check must carry
// what the server's plan reader reads.
// oxlint-disable-next-line import/no-nodejs-modules -- Pinned products are folders.
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- A product's sections live under its folder.
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { engineHeadlessSections as serverHeadlessSections } from '../src/shared/host/headlessSections';
import { planPortalRide } from '../src/server/game/shardfile/declaredPortalRide';
import { sectionsPlan } from '../src/server/game/shardfile/serverPlan';
import { builtFolder } from '../src/test/game/builtFolder';

const plan = (name: string): unknown => JSON.parse(readFileSync(join(builtFolder('nine-dragon-stack'), 'sections', `${name}.json`), 'utf8'));

test('a headless check carries the server plan the server reads (Nine\'s portal ride)', (): void => {
  const built = new Map<string, unknown>([['client/plan', plan('client/plan')], ['server/plan', plan('server/plan')]]);
  const carried = serverHeadlessSections(built);
  expect(carried.has('server/plan')).toBe(true);
  const features = sectionsPlan(carried)?.features ?? [];
  expect(planPortalRide(features)).not.toBeNull();
});

test('an SDK 0.4.29 check, whose own narrowing drops server/plan, still carries the plan (its client/plan copy)', (): void => {
  const carried = serverHeadlessSections(new Map<string, unknown>([['client/plan', plan('client/plan')]]));
  expect(planPortalRide(sectionsPlan(carried)?.features ?? [])).not.toBeNull();
});
