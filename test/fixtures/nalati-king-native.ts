import type {PrepareHeadlessRuntime} from '../../src/server/host/headlessRuntime';
import {prepareNalatiChapter} from './nalati-chapter-native';

/** Enter only the real King composition over the earned chapter continuation. */
export const prepareHeadlessRuntime:PrepareHeadlessRuntime=preparation=>prepareNalatiChapter(preparation,true);
