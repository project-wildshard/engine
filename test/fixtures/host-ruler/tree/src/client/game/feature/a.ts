// HR4 fixture: product a's root.
import { play } from '../session/play';
import { hudExtra } from '../session/hudExtra';
import { oneUserSchema } from '@wildshard/format/oneUser';

export const a = [play, hudExtra, oneUserSchema];
