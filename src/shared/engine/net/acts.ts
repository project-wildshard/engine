import * as v from 'valibot';
import { NetActSchema, type NetAct } from '@wildshard/wire/netCommand';

// P1-E5.2c (§4.2): the acts the engine adds to the format's own. Chat is the engine's concern, so it never reaches the shard format.

/** Where a line of chat goes (J110): everyone in the room, which is J110's shard channel, or who stands near. No global channel. */
export const CHAT_CHANNELS = ['room', 'proximity'] as const;
export type ChatChannel = (typeof CHAT_CHANNELS)[number];
/** Say something. Plain text, cleaned and filtered on the server. */
export interface NetChatSay { readonly kind: 'chat'; readonly seq: number; readonly channel: ChatChannel; readonly text: string }
/** Report a line of chat by its id. */
export interface NetChatReport { readonly kind: 'report'; readonly seq: number; readonly line: number }
/** A lone player's word on the sky: their weather setting, or a dev's phase jump. A room shares its sky, so with others in it this does nothing. `at` is a phase's fraction, -1 for the mode's own. */
/** How an `interact` names a story flag on a shard whose page runs its story. */
export const STORY_ACT = 'story:';
/** The `interact` a page's DEV tab Unstuck sends (Jake, 2026-11-12): the server puts its player back where a fall would, with no fall. */
export const UNSTUCK_ACT = 'unstuck';
/** The `interact` the death card's Respawn now sends (QA 11-13, Jake: "It needs a button, a Respawn now button"): the server
 *  has already placed its fallen player, and ends that player's fade so their commands move them again. */
export const RESPAWN_NOW_ACT = 'respawn-now';
export interface NetClimateAct { readonly kind: 'climate'; readonly seq: number; readonly op: typeof CLIMATE_OPS[number]; readonly name: string; readonly at: number }
/** Buy one of the shard's goods, by its place in the shard's exchange. The server checks it and takes the price. */
export interface NetBuyAct { readonly kind: 'buy'; readonly seq: number; readonly good: number }
/** Claim a filled contract or tear one off the board, by its slot. */
export interface NetBoardAct { readonly kind: 'board'; readonly seq: number; readonly op: 'claim' | 'tear'; readonly slot: number }
/** Put on or take off a cosmetic this player owns. */
export interface NetWearAct { readonly kind: 'wear'; readonly seq: number; readonly id: string }
/** The `mem` inputs this page's pose programs read, comma separated: a server pack holds no programme, so it can't tell them from a brain's memory. */
export interface NetPoseAct { readonly kind: 'pose'; readonly seq: number; readonly names: string }
/** An act the sim takes on its tick. */
export type NetTickAct = NetAct | NetClimateAct | NetBuyAct | NetBoardAct | NetWearAct | NetPoseAct;
/** Any act a client may send. */
export type NetRoomAct = NetTickAct | NetChatSay | NetChatReport;
/** What a word on the sky says: its mode, a jump to a phase, a Developer's time of day, or where a page's day stood as a player came back from a room the world waited out. */
export const CLIMATE_OPS = ['mode', 'force', 'time', 'day'] as const;
/** The longest name a climate act may give. */
const CLIMATE_NAME = 64;
/** The longest list one pose act may give, net text's own cap: a page with more sends more than one. */
export const POSE_NAMES = 255;

const u16 = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(0xffff));
/** A decoded act fit for the room. */
export const NetRoomActSchema: v.GenericSchema<NetRoomAct> = v.union([NetActSchema,
  v.strictObject({ kind: v.literal('buy'), seq: u16, good: u16 }),
  v.strictObject({ kind: v.literal('pose'), seq: u16, names: v.pipe(v.string(), v.minLength(1), v.maxLength(POSE_NAMES)) }),
  v.strictObject({ kind: v.literal('wear'), seq: u16, id: v.pipe(v.string(), v.minLength(1), v.maxLength(CLIMATE_NAME)) }),
  v.strictObject({ kind: v.literal('board'), seq: u16, op: v.picklist(['claim', 'tear']), slot: u16 }),
  v.strictObject({ kind: v.literal('climate'), seq: u16, op: v.picklist(CLIMATE_OPS), name: v.pipe(v.string(), v.minLength(1), v.maxLength(CLIMATE_NAME)), at: v.pipe(v.number(), v.finite(), v.minValue(-1), v.maxValue(1)) }),
  v.strictObject({ kind: v.literal('chat'), seq: u16, channel: v.picklist(CHAT_CHANNELS), text: v.pipe(v.string(), v.minLength(1), v.maxLength(255)) }),
  v.strictObject({ kind: v.literal('report'), seq: u16, line: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(0xffffffff)) }),
]);
