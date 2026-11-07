import { MeleeContactsSchema } from '@wildshard/format/weaponProfiles';
import * as v from 'valibot';
import liftInputs from './fixtures/engine-lift/inputs.json' with { type: 'json' };
const { SIGNAL_MELEE_HOST } = liftInputs;
const WHIP_CONTACT_MOVES = v.parse(MeleeContactsSchema, liftInputs.WHIP_CONTACT_MOVES);
// oxlint-disable-next-line import/no-nodejs-modules -- Real Rapier bytes.
import { parseInteractionRows } from '@wildshard/format/questInteractions';
import { readFileSync } from 'node:fs';
import { expect,test } from 'vitest';
import { createSimHost } from '../src/server/engine/sim';
import { installNativeMelee,type NativeMeleeInput } from '../src/server/game/plugin/simulation';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { installInteractionRows,InteractionRules,playerInteractionRules } from '../src/shared/game/quest/interactionRows';


import { SIM_LEVEL } from './fixtures/sim-level/level';

// P1-E3: a whip's crack is whoever lashed it. The bot's own lash reaches the spot and raises the bot's own mark.
test('a bot\'s lash cracks a quest spot for the bot, not the first player', async () => {
  const host = createSimHost({ ...SIM_LEVEL, entities: [] }, { rapier: await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm'))) });
  try {
    const lead = leadPlayer(host), at = { x: 40, y: lead.position.y, z: 40 }, bot = host.addPlayer('bot:1', at);
    const spot = { id: 'crank', x: at.x, y: at.y + 1.68, z: at.z - 4, radius: .8 }, data = parseInteractionRows({ marks: [{ id: 'raised' }], rows: [{ id: 'crank', act: 1, at: 'crack.crank', crack: 'light', needs: [{ none: ['raised'] }], sets: ['raised'] }] });
    const rules = new InteractionRules(host.flags, data);
    let commands: readonly NativeMeleeInput[] = [];
    const melee = installNativeMelee(host, { id: 'weapon.sunscar-dunes.whip', contacts: WHIP_CONTACT_MOVES }, SIGNAL_MELEE_HOST, { inputCommands: () => [], worldActor: 'quest',
      questWorld: { row: { graph: { actor: 'quest' }, interactions: data }, spots: { crack: [spot], interact: [] } } as never,
      others: { commands: player => player === bot ? commands : [], enabled: () => true } });
    installInteractionRows(host, rules, { actorId: 'quest', stepId: 'quest.targets', commands: () => [], spots: { 'crack.crank': spot }, crack: { reach: { light: 7, heavy: 8 }, cracked: melee.cracked } });
    commands = [{ kind: 'script', actorId: 'quest', value: 1 }]; host.step(); commands = [];
    for (let tick = 0; tick < 24; tick++) host.step();
    expect(playerInteractionRules(host, rules)(bot.id).has('raised'), 'the mark is the bot\'s').toBe(true);
    expect(rules.has('raised'), 'and not the first player\'s').toBe(false);
  } finally { host.dispose(); }
});

// A net client's charge names no target: it lands where they look, so a double crack reaches a quest's crank off a command stream.
test('a held charge let go with nothing named cracks the spot ahead', async () => {
  const host = createSimHost({ ...SIM_LEVEL, entities: [] }, { rapier: await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm'))) });
  try {
    const lead = leadPlayer(host), at = lead.position, spot = { id: 'crank', x: at.x, y: at.y + 1.68, z: at.z - 4, radius: .8 };
    const data = parseInteractionRows({ marks: [{ id: 'raised' }], rows: [{ id: 'crank', act: 1, at: 'crack.crank', crack: 'heavy', needs: [{ none: ['raised'] }], sets: ['raised'] }] });
    const rules = new InteractionRules(host.flags, data);
    let commands: readonly NativeMeleeInput[] = [];
    const melee = installNativeMelee(host, { id: 'weapon.sunscar-dunes.whip', contacts: WHIP_CONTACT_MOVES }, SIGNAL_MELEE_HOST, { inputCommands: () => commands, worldActor: 'quest',
      questWorld: { row: { graph: { actor: 'quest' }, interactions: data }, spots: { crack: [spot], interact: [] } } as never });
    installInteractionRows(host, rules, { actorId: 'quest', stepId: 'quest.targets', commands: () => [], spots: { 'crack.crank': spot }, crack: { reach: { light: 7, heavy: 8 }, cracked: melee.cracked } });
    commands = [{ kind: 'player', heavy: {}, swing: true, pitch: 0 }];
    for (let tick = 0; tick < 50; tick++) host.step();
    expect(rules.has('raised'), 'a hold alone cracks nothing').toBe(false);
    commands = [{ kind: 'player', pitch: 0 }];
    for (let tick = 0; tick < 90; tick++) host.step();
    expect(rules.has('raised')).toBe(true);
  } finally { host.dispose(); }
});
