/** SERVER-PARITY SS4: the page's stealth law, run by the room server for each player. The page doubled a bow shot loosed
 *  from Hidden (`stealth.entry`, `player/stealth` sneak rows) while the server dealt plain damage. Each seat now steps the same
 *  StealthCrouch from that player's own crouch, grass, herds, packs and mount; the server's arms ask it for the multiplier.
 *  The page keeps its HUD, disc and hint; nothing here is drawn or sent. */
import * as v from 'valibot';
import { StealthRowsSchema } from '@wildshard/format/stealth';
import { ClientPlanSchema } from '@wildshard/format/clientPlan';
import type { SimHost } from '@wildshard/engine/sim';
import type { PlayerSim } from '@wildshard/engine/sim/playerSim';
import { StealthCrouch, sampleStealthSources } from '../../../shared/game/stealth/stealthLaw';
import type { ShardFolder } from '../../../shared/game/shardfile/shardFolder';
import { playerSeats, type PlayerSeat, type PlayerSeats } from '../plugin/playerSeats';
import { mountedPlayerOf } from '../riding/native';
import { nativeTamingControls, nativeTamingOf } from '../riding/nativeTaming';
import type { NativeGroupCollection } from '../shardfile/groupRuntime';

const finite = v.pipe(v.number(), v.finite()), truth = v.boolean();
const Threat = v.strictObject({ x: finite, z: finite, awareness: finite, alert: finite, hunting: finite });
const Saved = v.strictObject({ detection: v.strictObject({ state: v.record(v.string(), finite), elapsed: finite }),
  state: v.string(), cover: finite, threat: finite, inLongGrass: truth, canCrouch: truth, latched: truth, threatX: finite, threatZ: finite,
  pendingToggle: truth, pendingCancel: truth, toggleWas: truth, shotUntil: finite, t: finite, hinted: truth,
  observation: v.strictObject({ grass: finite, mounted: truth, forced: truth, threats: v.pipe(v.array(Threat), v.maxLength(8)) }) });

/** One tick command, as the stealth law reads it: the player's own crouch, sprint, jump and stick. */
interface StealthCommand { readonly kind: string; readonly crouch?: boolean; readonly sprint?: boolean; readonly jump?: boolean;
  readonly steer?: { readonly keyY: number; readonly stickY: number } }
/** The tick's commands: the first player's list, then each other player's. */
export interface StealthTick { readonly commands: () => readonly StealthCommand[]; readonly commandsOf: (id: string) => readonly StealthCommand[] }
/** One player's stealth: their state, and the sneak shot the arms ask for. */
export interface StealthSeat extends PlayerSeat {
  /** A weapon fired: opens the sneak window if this player is in the sneak state now (the page's `weapon.fired`). */
  readonly noteShot: () => void;
  /** The damage multiplier for a blow landing now. */
  readonly sneakMultiplier: () => number;
  readonly state: () => string;
}
const owners = new WeakMap<SimHost, PlayerSeats<StealthSeat>>();
/** This host's stealth, a seat for each player; none when the product has no stealth entry or this is no room. */
export function nativeStealthOf(host: SimHost): PlayerSeats<StealthSeat> | undefined { return owners.get(host); }

/** Read the page's own stealth rows now, when its client plan enters stealth; the returned step installs them on one room host. */
export function prepareNativeStealth(product: Pick<ShardFolder, 'section'>): ((host: SimHost, context: { readonly tick: StealthTick; readonly groups: NativeGroupCollection | undefined }) => void) | null {
  if (!v.parse(ClientPlanSchema, product.section('client/plan')).features.some(row => row.kind === 'stealth.entry')) return null;
  const rows = v.parse(StealthRowsSchema, product.section('player/stealth')), sources = rows.observations;
  if (sources === undefined) throw new Error('Native stealth requires its admitted observation sources');
  return (host, { tick, groups }) => {
    const grass = groups?.environment, taming = nativeTamingOf(host), controls = nativeTamingControls(host);
    if (groups === undefined || grass === undefined || taming === undefined || controls === undefined) throw new Error('Native stealth requires actual native groups, grass and taming');
    if (owners.has(host)) throw new Error('Native stealth already has an owner');
    const seats = playerSeats<StealthSeat>(host, (player: PlayerSim, first: boolean) => {
      const mount = mountedPlayerOf(host, first ? undefined : player.id);
      if (mount === undefined) throw new Error('Native stealth requires actual native riding');
      const law = new StealthCrouch(rows, first ? host.scope : host.scope.child(`stealth:${player.id}`));
      const trust = (): number | null => (first ? taming : controls.sessionOf(player.id))?.view.trust ?? null;
      return {
        noteShot: () => { law.noteShot(); }, sneakMultiplier: () => law.sneakMultiplier(), state: () => law.state,
        step: dt => {
          let own: StealthCommand | undefined;
          for (const command of first ? tick.commands() : tick.commandsOf(player.id)) if (command.kind === 'player') own = command;
          // The page's sprint: held, with forward held or the stick pushed past a tenth.
          const forward = own?.steer !== undefined && (own.steer.keyY > 0 || own.steer.stickY > .1), feet = player.position;
          law.step(dt, { sprint: own?.sprint === true && forward, jump: own?.jump === true, hover: player.board.on, swimming: player.swim.on,
            practice: false, crouching: mount.rider.crouching, x: feet.x, z: feet.z });
          law.observe(host.clock.now, sampleStealthSources(sources, player, { population: groups, grass,
            riding: { mounted: mount.mounted, taming: { view: { trust: trust() } } } }));
        },
        snapshot: () => JSON.stringify(law.snapshot()),
        restore: input => { law.restore(v.parse(Saved, typeof input === 'string' ? JSON.parse(input) : input)); },
      };
    });
    owners.set(host, seats); host.scope.onDispose(() => { owners.delete(host); });
    host.onStep(rows.system, seats.step, seats.adapter, 'afterBodies');
  };
}
