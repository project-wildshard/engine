import {
  BowWeaponProfileSchema,
  parseNativeFirearmProfile,
} from '@wildshard/format/weaponProfiles'
import * as v from 'valibot'

import original from './pine-item-profiles.json' with { type: 'json' }

/** Frozen inputs for the preserved legacy installers; current rows are independently read from the real product. */
export const CROSSBOW_WEAPON_PROFILE = parseNativeFirearmProfile(
  original.crossbow,
  'bolt',
)
export const BOW_PROFILE = v.parse(BowWeaponProfileSchema, original.longbow)
const lever = parseNativeFirearmProfile(original.lever, 'lever')
if (lever.lever === undefined)
  throw new Error('Frozen lever fixture lacks its cycle')
export const LEVER_WEAPON_PROFILE = { ...lever, lever: lever.lever }
